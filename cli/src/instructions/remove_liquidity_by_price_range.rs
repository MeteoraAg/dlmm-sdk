use crate::instructions::utils::get_or_create_ata;
use crate::math::{get_id_from_price, price_per_token_to_per_lamport};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::constants::MAX_BIN_PER_POSITION;
use lb_clmm::instruction;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::Position;
use lb_clmm::utils::pda::*;
use std::ops::Deref;
use std::result::Result::Ok;

#[derive(Debug)]
pub struct RemoveLiquidityByPriceRangeParameters {
    pub bin_step: u16,
    pub permission: bool,
    pub base_position_key: Pubkey,
    pub token_mint_x: Pubkey,
    pub token_mint_y: Pubkey,
    pub min_price: f64,
    pub max_price: f64,
}

pub fn remove_liquidity_by_price_range<C: Deref<Target = impl Signer> + Clone>(
    params: RemoveLiquidityByPriceRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let RemoveLiquidityByPriceRangeParameters {
        bin_step,
        permission,
        base_position_key,
        token_mint_x,
        token_mint_y,
        min_price,
        max_price,
    } = params;

    let (lb_pair, _bump) = derive_lb_pair_pda(token_mint_x, token_mint_y, bin_step, permission);

    let lb_pair_state: LbPair = program.account(lb_pair)?;
    let bin_step = lb_pair_state.bin_step;

    let token_mint_base: Mint = program.account(token_mint_x)?;
    let token_mint_quote: Mint = program.account(token_mint_y)?;

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
    let max_active_id = get_id_from_price(bin_step, &max_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    assert_eq!(min_active_id < max_active_id, true);

    println!("go here");
    let width = MAX_BIN_PER_POSITION as i32;
    for i in min_active_id..=max_active_id {
        let (position, _bump) = derive_position_pda(lb_pair, base_position_key, i, width);

        // if program.rpc().get_account_data(&position).is_ok() {
        //     let position_state: Position = program.account(position)?;
        //     println!("{position_state:?}");
        // }
        // continue;

        match program.account::<Position>(position) {
            Ok(position_state) => {
                let lower_bin_array_idx =
                    BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
                let upper_bin_array_idx =
                    lower_bin_array_idx.checked_add(1).context("MathOverflow")?;

                let (bin_array_lower, _bump) =
                    derive_bin_array_pda(lb_pair, lower_bin_array_idx.into());
                let (bin_array_upper, _bump) =
                    derive_bin_array_pda(lb_pair, upper_bin_array_idx.into());
                let user_token_x = get_or_create_ata(
                    &program,
                    transaction_config,
                    lb_pair_state.token_x_mint,
                    program.payer(),
                )?;

                let user_token_y = get_or_create_ata(
                    &program,
                    transaction_config,
                    lb_pair_state.token_y_mint,
                    program.payer(),
                )?;
                let (event_authority, _bump) = derive_event_authority_pda();

                let instructions = vec![
                    ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
                    Instruction {
                        program_id: lb_clmm::ID,
                        accounts: accounts::ModifyLiquidity {
                            bin_array_lower,
                            bin_array_upper,
                            lb_pair,
                            bin_array_bitmap_extension: None,
                            position,
                            reserve_x: lb_pair_state.reserve_x,
                            reserve_y: lb_pair_state.reserve_y,
                            token_x_mint: lb_pair_state.token_x_mint,
                            token_y_mint: lb_pair_state.token_y_mint,
                            sender: program.payer(),
                            user_token_x,
                            user_token_y,
                            token_x_program: anchor_spl::token::ID,
                            token_y_program: anchor_spl::token::ID,
                            event_authority,
                            program: lb_clmm::ID,
                        }
                        .to_account_metas(None),
                        data: instruction::RemoveAllLiquidity {}.data(),
                    },
                    Instruction {
                        program_id: lb_clmm::ID,
                        accounts: accounts::ClaimFee {
                            bin_array_lower,
                            bin_array_upper,
                            lb_pair,
                            sender: program.payer(),
                            position,
                            reserve_x: lb_pair_state.reserve_x,
                            reserve_y: lb_pair_state.reserve_y,
                            token_program: anchor_spl::token::ID,
                            token_x_mint: lb_pair_state.token_x_mint,
                            token_y_mint: lb_pair_state.token_y_mint,
                            user_token_x,
                            user_token_y,
                            event_authority,
                            program: lb_clmm::ID,
                        }
                        .to_account_metas(None),
                        data: instruction::ClaimFee {}.data(),
                    },
                    Instruction {
                        program_id: lb_clmm::ID,
                        accounts: accounts::ClosePosition {
                            lb_pair,
                            position,
                            bin_array_lower,
                            bin_array_upper,
                            rent_receiver: program.payer(),
                            sender: program.payer(),
                            event_authority,
                            program: lb_clmm::ID,
                        }
                        .to_account_metas(None),
                        data: instruction::ClosePosition {}.data(),
                    },
                ];

                let builder = program.request();
                let builder = instructions
                    .into_iter()
                    .fold(builder, |bld, ix| bld.instruction(ix));
                let signature = builder.send_with_spinner_and_config(transaction_config)?;
                println!("close popsition min_bin_id {i} {signature}");
            }
            Err(_err) => continue,
        }
    }
    Ok(())
}
