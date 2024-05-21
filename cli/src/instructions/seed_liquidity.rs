use std::ops::Deref;

use crate::instructions::utils::get_or_create_ata;
use crate::math::{
    get_id_from_price, price_per_lamport_to_price_per_token, price_per_token_to_per_lamport,
};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::solana_sdk::signature::Keypair;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::token::{Mint, TokenAccount};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::constants::{BASIS_POINT_MAX, MAX_BIN_PER_POSITION};
use lb_clmm::instruction;
use lb_clmm::instructions::add_liquidity::{BinLiquidityDistribution, LiquidityParameter};
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda::*;
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::{Decimal, MathematicalOps};

#[derive(Debug)]
pub struct SeedLiquidityParameters {
    pub lb_pair: Pubkey,
    pub position_base_kp: Keypair,
    pub amount: u64,
    pub min_price: f64,
    pub max_price: f64,
}

pub async fn seed_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: SeedLiquidityParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SeedLiquidityParameters {
        lb_pair,
        position_base_kp,
        amount,
        min_price,
        max_price,
    } = params;
    let lb_pair_state: LbPair = program.account(lb_pair).await?;
    let bin_step = lb_pair_state.bin_step;

    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint).await?;

    // convert to wei amount
    let amount = amount
        .checked_mul(10u64.pow(token_mint_base.decimals as u32))
        .unwrap();

    let min_price_per_lamport = price_per_token_to_per_lamport(
        min_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;
    let min_active_id = get_id_from_price(bin_step, &min_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let max_price_per_lamport = price_per_token_to_per_lamport(
        max_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;
    let max_active_id = get_id_from_price(bin_step, &max_price_per_lamport, Rounding::Down)
        .context("get_id_from_price overflow")?;

    assert!(min_active_id < max_active_id);

    let mut position_number =
        (max_active_id.checked_sub(min_active_id).unwrap()) / MAX_BIN_PER_POSITION as i32;
    let rem = (max_active_id.checked_sub(min_active_id).unwrap()) % MAX_BIN_PER_POSITION as i32;

    if rem > 0 {
        position_number += 1;
    }

    println!("seed liquidity min_id {min_active_id} max_id {max_active_id} position_number {position_number}");

    let (event_authority, _bump) = derive_event_authority_pda();

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
    )
    .await?;

    let width = MAX_BIN_PER_POSITION as i32;

    for i in 0..position_number {
        let lower_bin_id = min_active_id + (MAX_BIN_PER_POSITION as i32 * i);
        let upper_bin_id = lower_bin_id + MAX_BIN_PER_POSITION as i32 - 1;

        let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
        let upper_bin_array_idx = BinArray::bin_id_to_bin_array_index(upper_bin_id)?;

        for idx in lower_bin_array_idx..=upper_bin_array_idx {
            // Initialize bin array if not exists
            let (bin_array, _bump) = derive_bin_array_pda(lb_pair, idx.into());

            if program.rpc().get_account_data(&bin_array).is_err() {
                let accounts = accounts::InitializeBinArray {
                    bin_array,
                    funder: program.payer(),
                    lb_pair,
                    system_program: anchor_client::solana_sdk::system_program::ID,
                };

                let ix = instruction::InitializeBinArray { index: idx.into() };

                let request_builder = program.request();
                let signature = request_builder
                    .accounts(accounts)
                    .args(ix)
                    .send_with_spinner_and_config(transaction_config)
                    .await?;
                println!("Init bin array {idx} {signature}");
            }
        }

        let upper_bin_id = std::cmp::min(
            lower_bin_id + MAX_BIN_PER_POSITION as i32 - 1,
            max_active_id,
        );

        // Initialize position if not exists
        let (position, _bump) =
            derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

        if program.rpc().get_account_data(&position).is_ok() {
            continue;
        } else {
            let ix = Instruction {
                program_id: lb_clmm::ID,
                accounts: accounts::InitializePositionPda {
                    lb_pair,
                    base: position_base_kp.pubkey(),
                    payer: program.payer(),
                    position,
                    owner: program.payer(),
                    rent: anchor_client::solana_sdk::sysvar::rent::ID,
                    system_program: anchor_client::solana_sdk::system_program::ID,
                    event_authority,
                    program: lb_clmm::ID,
                }
                .to_account_metas(None),
                data: instruction::InitializePositionPda {
                    lower_bin_id,
                    width,
                }
                .data(),
            };
            let builder = program.request().instruction(ix).signer(&position_base_kp);
            let signature = builder
                .send_with_spinner_and_config(transaction_config)
                .await;
            println!("Create position lower bin id {lower_bin_id} upper bin id {upper_bin_id}. signature {:#?}", signature);
            signature?;
        }

        let position_state: PositionV2 = program.account(position).await.unwrap();
        if !position_state.is_empty() {
            continue;
        }

        let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

        let (bin_array_lower, _bump) = derive_bin_array_pda(lb_pair, lower_bin_array_idx.into());
        let (bin_array_upper, _bump) = derive_bin_array_pda(lb_pair, upper_bin_array_idx.into());

        let mut bin_amounts = vec![];
        let mut position_total_amount = 0;

        for bin_id in lower_bin_id..=upper_bin_id {
            let bin_amount = get_bin_deposit_amount(
                amount,
                bin_step,
                bin_id,
                token_mint_base.decimals,
                token_mint_quote.decimals,
            );

            bin_amounts.push(bin_amount);
            position_total_amount += bin_amount;
        }

        let mut bin_liquidity_dist = vec![];

        for (idx, bin_id) in (lower_bin_id..=upper_bin_id).enumerate() {
            bin_liquidity_dist.push(BinLiquidityDistribution {
                bin_id,
                distribution_x: (bin_amounts[idx] as u128 * BASIS_POINT_MAX as u128
                    / position_total_amount as u128)
                    .try_into()
                    .unwrap(),
                distribution_y: 0,
            });
        }

        instructions.push(Instruction {
            program_id: lb_clmm::ID,
            accounts: accounts::ModifyLiquidity {
                lb_pair,
                position,
                bin_array_bitmap_extension: None,
                bin_array_lower,
                bin_array_upper,
                sender: program.payer(),
                event_authority,
                program: lb_clmm::ID,
                reserve_x: lb_pair_state.reserve_x,
                reserve_y: lb_pair_state.reserve_y,
                token_x_mint: lb_pair_state.token_x_mint,
                token_y_mint: lb_pair_state.token_y_mint,
                user_token_x,
                user_token_y,
                token_x_program: anchor_spl::token::ID,
                token_y_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
            data: instruction::AddLiquidity {
                liquidity_parameter: LiquidityParameter {
                    amount_x: position_total_amount,
                    amount_y: 0,
                    bin_liquidity_dist,
                },
            }
            .data(),
        });

        let builder = program.request();

        let builder = instructions
            .into_iter()
            .fold(builder, |bld, ix| bld.instruction(ix));
        let signature = builder
            .send_with_spinner_and_config(transaction_config)
            .await;
        println!(
            "seed liquidity min_bin_id {lower_bin_id} max_bin_id {upper_bin_id} {:#?}",
            signature
        );
        signature?;
    }

    let reserve_x_state: TokenAccount = program.account(lb_pair_state.reserve_x).await.unwrap();
    let leftover = amount.checked_sub(reserve_x_state.amount).unwrap();

    if leftover > 0 {
        let lower_bin_id = min_active_id + MAX_BIN_PER_POSITION as i32 * (position_number - 1);
        let upper_bin_id = lower_bin_id + MAX_BIN_PER_POSITION as i32 - 1;

        let (position, _bump) =
            derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

        let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
        let upper_bin_array_idx = BinArray::bin_id_to_bin_array_index(upper_bin_id)?;

        let (bin_array_lower, _bump) = derive_bin_array_pda(lb_pair, lower_bin_array_idx.into());
        let (bin_array_upper, _bump) = derive_bin_array_pda(lb_pair, upper_bin_array_idx.into());

        let ix = Instruction {
            program_id: lb_clmm::ID,
            accounts: accounts::ModifyLiquidity {
                lb_pair,
                position,
                bin_array_bitmap_extension: None,
                bin_array_lower,
                bin_array_upper,
                sender: program.payer(),
                event_authority,
                program: lb_clmm::ID,
                reserve_x: lb_pair_state.reserve_x,
                reserve_y: lb_pair_state.reserve_y,
                token_x_mint: lb_pair_state.token_x_mint,
                token_y_mint: lb_pair_state.token_y_mint,
                user_token_x,
                user_token_y,
                token_x_program: anchor_spl::token::ID,
                token_y_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
            data: instruction::AddLiquidity {
                liquidity_parameter: LiquidityParameter {
                    amount_x: leftover,
                    amount_y: 0,
                    bin_liquidity_dist: vec![BinLiquidityDistribution {
                        bin_id: max_active_id,
                        distribution_x: 10000,
                        distribution_y: 0,
                    }],
                },
            }
            .data(),
        };

        let builder = program
            .request()
            .instruction(ComputeBudgetInstruction::set_compute_unit_limit(1_400_000))
            .instruction(ix);

        let signature = builder
            .send_with_spinner_and_config(transaction_config)
            .await;
        println!(
            "seed liquidity for precision loss bin id {max_active_id} amount {leftover} {:#?}",
            signature
        );
        signature?;
    }

    // sanity check
    let reserve_x_state: TokenAccount = program.account(lb_pair_state.reserve_x).await.unwrap();
    assert!(reserve_x_state.amount == amount);

    Ok(())
}

fn get_bin_deposit_amount(
    amount: u64,
    bin_step: u16,
    bin_id: i32,
    base_token_decimal: u8,
    quote_token_decimal: u8,
) -> u64 {
    let c1 = get_c(
        amount,
        bin_step,
        bin_id + 1,
        base_token_decimal,
        quote_token_decimal,
    );

    let c0 = get_c(
        amount,
        bin_step,
        bin_id,
        base_token_decimal,
        quote_token_decimal,
    );

    assert!(c1 > c0);

    let amount_into_bin = c1 - c0;
    amount_into_bin.to_u64().unwrap()
}

// c(p) = 5 * 10^8 ((p - 0.1)/0.7) ^ 1.25, where P = ui price
fn get_c(
    amount: u64,
    bin_step: u16,
    bin_id: i32,
    base_token_decimal: u8,
    quote_token_decimal: u8,
) -> Decimal {
    let price_per_lamport = (1.0 + bin_step as f64 / 10000.0).powi(bin_id);

    let current_price = price_per_lamport_to_price_per_token(
        price_per_lamport,
        base_token_decimal,
        quote_token_decimal,
    )
    .unwrap();

    let amount = Decimal::from_u64(amount).unwrap();
    let min_price = Decimal::from_f64(0.1).unwrap();
    let price_range = Decimal::from_f64(0.7).unwrap();

    let capped_current_price = std::cmp::min(current_price, min_price + price_range);

    let current_price_delta_from_min = capped_current_price.checked_sub(min_price).unwrap();

    amount
        .checked_mul((current_price_delta_from_min / price_range).powf(1.25))
        .unwrap()
}
