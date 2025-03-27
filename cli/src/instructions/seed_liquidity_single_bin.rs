use std::ops::Deref;

use anchor_client::{
    solana_client::rpc_config::RpcSendTransactionConfig,
    solana_sdk::{
        compute_budget::ComputeBudgetInstruction, instruction::Instruction, pubkey::Pubkey,
        signature::Keypair, signer::Signer,
    },
    Program,
};
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::token::Mint;
use anyhow::{Context, Result};
use lb_clmm::{
    accounts, instruction,
    instructions::deposit::{BinLiquidityDistribution, LiquidityParameter},
    math::u128x128_math::Rounding,
    state::bin::BinArray,
    utils::pda::{
        derive_bin_array_bitmap_extension, derive_bin_array_pda, derive_event_authority_pda,
    },
};
use lb_clmm::{state::lb_pair::LbPair, utils::pda::derive_position_pda};

use crate::{
    instructions::{seed_liquidity::to_wei_amount, utils::get_or_create_ata},
    math::{get_id_from_price, get_precise_id_from_price, price_per_token_to_per_lamport},
    SelectiveRounding,
};

pub struct SeedLiquiditySingleBinParameters {
    pub lb_pair: Pubkey,
    pub position_base_kp: Keypair,
    pub amount: u64,
    pub price: f64,
    pub position_owner_kp: Keypair,
    pub base_pubkey: Pubkey,
    pub selective_rounding: SelectiveRounding,
}

pub async fn seed_liquidity_single_bin<C: Deref<Target = impl Signer> + Clone>(
    params: SeedLiquiditySingleBinParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let SeedLiquiditySingleBinParameters {
        lb_pair,
        position_base_kp,
        amount,
        price,
        position_owner_kp,
        base_pubkey,
        selective_rounding,
    } = params;

    assert_eq!(
        position_base_kp.pubkey(),
        base_pubkey,
        "Invalid position base key"
    );

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let bin_step = lb_pair_state.bin_step;

    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint).await?;

    let native_amount = to_wei_amount(amount, token_mint_base.decimals)?;

    let price =
        price_per_token_to_per_lamport(price, token_mint_base.decimals, token_mint_quote.decimals)
            .context("price_per_token_per_lamport overflow")?;

    let bin_id = match selective_rounding {
        SelectiveRounding::None => get_precise_id_from_price(bin_step, &price)
            .context("fail to get exact bin id for the price"),
        SelectiveRounding::Down => get_id_from_price(bin_step, &price, Rounding::Down)
            .context("get_id_from_price overflow"),
        SelectiveRounding::Up => {
            get_id_from_price(bin_step, &price, Rounding::Up).context("get_id_from_price overflow")
        }
    }?;

    assert_eq!(
        lb_pair_state.active_id, bin_id,
        "bin id doesn't match active bin id"
    );

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let (event_authority, _bump) = derive_event_authority_pda();
    let (position, _bump) = derive_position_pda(lb_pair, base_pubkey, bin_id, 1);

    let lower_bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id)?;
    let upper_bin_array_index = lower_bin_array_index + 1;

    let (lower_bin_array, _bump) = derive_bin_array_pda(lb_pair, lower_bin_array_index.into());
    let (upper_bin_array, _bump) = derive_bin_array_pda(lb_pair, upper_bin_array_index.into());

    let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

    if let Some(priority_fee_ix) = compute_unit_price {
        instructions.push(priority_fee_ix);
    }

    let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
    // We only deposit to lower bin array
    let overflow_internal_bitmap_range =
        lower_bin_array_index > max_bitmap_id || lower_bin_array_index < min_bitmap_id;
    let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    if overflow_internal_bitmap_range {
        let bitmap_extension_account = program.rpc().get_account(&bin_array_bitmap_extension);
        if bitmap_extension_account.is_err() {
            let initialize_bitmap_extension = Instruction {
                program_id: lb_clmm::ID,
                accounts: accounts::InitializeBinArrayBitmapExtension {
                    lb_pair,
                    bin_array_bitmap_extension,
                    funder: program.payer(),
                    system_program: anchor_lang::system_program::ID,
                    rent: anchor_lang::solana_program::sysvar::rent::ID,
                }
                .to_account_metas(None),
                data: instruction::InitializeBinArrayBitmapExtension {}.data(),
            };
            instructions.push(initialize_bitmap_extension);
        }
    }

    let bin_array_bitmap_extension = if overflow_internal_bitmap_range {
        Some(bin_array_bitmap_extension)
    } else {
        Some(lb_clmm::ID)
    };

    let initialize_position_ix = Instruction {
        program_id: lb_clmm::ID,
        accounts: accounts::InitializePositionPda {
            position,
            base: base_pubkey,
            payer: program.payer(),
            owner: position_owner_kp.pubkey(),
            lb_pair,
            system_program: anchor_lang::system_program::ID,
            rent: anchor_lang::solana_program::sysvar::rent::ID,
            program: lb_clmm::ID,
            event_authority,
        }
        .to_account_metas(None),
        data: instruction::InitializePositionPda {
            lower_bin_id: bin_id,
            width: 1,
        }
        .data(),
    };

    instructions.push(initialize_position_ix);

    for (bin_array, bin_array_index) in [
        (lower_bin_array, lower_bin_array_index),
        (upper_bin_array, upper_bin_array_index),
    ] {
        if program.rpc().get_account(&lower_bin_array).is_err() {
            let initialize_bin_array_ix = Instruction {
                program_id: lb_clmm::ID,
                accounts: accounts::InitializeBinArray {
                    lb_pair,
                    bin_array,
                    funder: program.payer(),
                    system_program: anchor_lang::system_program::ID,
                }
                .to_account_metas(None),
                data: instruction::InitializeBinArray {
                    index: bin_array_index.into(),
                }
                .data(),
            };

            instructions.push(initialize_bin_array_ix);
        }
    }

    let deposit_ix = Instruction {
        program_id: lb_clmm::ID,
        accounts: accounts::ModifyLiquidity {
            position,
            lb_pair,
            bin_array_bitmap_extension,
            user_token_x,
            user_token_y,
            reserve_x: lb_pair_state.reserve_x,
            reserve_y: lb_pair_state.reserve_y,
            token_x_mint: lb_pair_state.token_x_mint,
            token_y_mint: lb_pair_state.token_y_mint,
            bin_array_lower: lower_bin_array,
            bin_array_upper: upper_bin_array,
            sender: program.payer(),
            token_x_program: anchor_spl::token::ID,
            token_y_program: anchor_spl::token::ID,
            event_authority,
            program: lb_clmm::ID,
        }
        .to_account_metas(None),
        data: instruction::AddLiquidity {
            liquidity_parameter: LiquidityParameter {
                amount_x: native_amount,
                amount_y: 0,
                bin_liquidity_dist: vec![BinLiquidityDistribution {
                    bin_id,
                    distribution_x: 10000,
                    distribution_y: 0,
                }],
            },
        }
        .data(),
    };

    instructions.push(deposit_ix);

    let mut builder = program.request();
    builder = builder.signer(&position_base_kp);
    builder = instructions
        .into_iter()
        .fold(builder, |builder, ix| builder.instruction(ix));

    let signature = builder
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("{:#?}", signature);

    signature?;

    Ok(())
}
