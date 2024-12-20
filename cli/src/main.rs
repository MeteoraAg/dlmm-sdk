use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::*;
use anchor_client::{
    solana_client::rpc_config::RpcSendTransactionConfig,
    solana_sdk::pubkey::Pubkey,
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signer::{keypair::*, Signer},
    },
};
use anchor_lang::prelude::AccountMeta;
use anyhow::*;
use clap::*;
use commons::*;
use solana_account_decoder::*;
use std::ops::Deref;
use std::rc::Rc;
use std::time::Duration;

mod args;
mod instructions;
mod math;

use args::*;
use commons::rpc_client_extension::*;
use dlmm_interface::*;
use instructions::*;
use math::*;

fn get_set_compute_unit_price_ix(micro_lamports: u64) -> Option<Instruction> {
    if micro_lamports > 0 {
        Some(ComputeBudgetInstruction::set_compute_unit_price(
            micro_lamports,
        ))
    } else {
        None
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    let payer =
        read_keypair_file(cli.config_override.wallet).expect("Wallet keypair file not found");

    println!("Wallet {:#?}", payer.pubkey());

    let commitment_config = CommitmentConfig::confirmed();

    let client = Client::new_with_options(
        cli.config_override.cluster,
        Rc::new(Keypair::from_bytes(&payer.to_bytes())?),
        commitment_config,
    );

    let amm_program = client.program(dlmm_interface::ID).unwrap();

    let rpc_client = amm_program.async_rpc();

    let transaction_config: RpcSendTransactionConfig = RpcSendTransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(commitment_config.commitment),
        encoding: None,
        max_retries: None,
        min_context_slot: None,
    };

    let compute_unit_price_ix = get_set_compute_unit_price_ix(cli.config_override.priority_fee);

    match cli.command {
        Command::InitializePair {
            initial_price,
            token_mint_x,
            token_mint_y,
            preset_parameter,
        } => {
            let params = InitLbPairParameters {
                token_mint_x,
                token_mint_y,
                preset_parameter,
                initial_price,
            };
            initialize_lb_pair(params, &amm_program, transaction_config).await?;
        }
        Command::InitializeBinArray {
            bin_array_index,
            lb_pair,
        } => {
            let params = InitBinArrayParameters {
                bin_array_index,
                lb_pair,
            };
            initialize_bin_array(params, &amm_program, transaction_config).await?;
        }
        Command::InitializeBinArrayWithPriceRange {
            lower_price,
            upper_price,
            lb_pair,
        } => {
            let params = InitBinArrayWithPriceRangeParameters {
                lb_pair,
                lower_price,
                upper_price,
            };
            initialize_bin_array_with_price_range(params, &amm_program, transaction_config).await?;
        }
        Command::InitializeBinArrayWithBinRange {
            lb_pair,
            lower_bin_id,
            upper_bin_id,
        } => {
            let params = InitBinArrayWithBinRangeParameters {
                lb_pair,
                lower_bin_id,
                upper_bin_id,
            };
            initialize_bin_array_with_bin_range(params, &amm_program, transaction_config).await?;
        }
        Command::InitializePositionWithPriceRange {
            lb_pair,
            lower_price,
            width,
            nft_mint,
        } => {
            let params = InitPositionWithPriceRangeParameters {
                lb_pair,
                lower_price,
                width,
                nft_mint,
            };
            initialize_position_with_price_range(params, &amm_program, transaction_config).await?;
        }
        Command::InitializePosition {
            lb_pair,
            lower_bin_id,
            width,
            nft_mint,
        } => {
            let params = InitPositionParameters {
                lb_pair,
                lower_bin_id,
                nft_mint,
                width,
            };
            initialize_position(params, &amm_program, transaction_config).await?;
        }
        Command::AddLiquidity {
            lb_pair,
            position,
            amount_x,
            amount_y,
            bin_liquidity_distribution,
        } => {
            let params = AddLiquidityParam {
                lb_pair,
                amount_x,
                amount_y,
                bin_liquidity_distribution,
                position,
            };
            execute_add_liquidity(params, &amm_program, transaction_config).await?;
        }
        Command::RemoveLiquidity {
            lb_pair,
            position,
            bin_liquidity_removal,
        } => {
            let params = RemoveLiquidityParameters {
                lb_pair,
                position,
                bin_liquidity_removal,
            };
            remove_liquidity(params, &amm_program, transaction_config).await?;
        }
        Command::SwapExactIn {
            lb_pair,
            amount_in,
            swap_for_y,
        } => {
            let params = SwapExactInParameters {
                amount_in,
                lb_pair,
                swap_for_y,
            };
            swap(params, &amm_program, transaction_config).await?;
        }

        Command::ShowPair { lb_pair } => {
            show_pair(lb_pair, &amm_program).await?;
        }
        Command::ShowPosition { position } => {
            let position_account = rpc_client.get_account(&position).await?;

            let disc = &position_account.data[0..8];

            let position_state = match disc {
                POSITION_ACCOUNT_DISCM => PositionAccount::deserialize(&position_account.data)?,
                POSITION_V2_ACCOUNT_DISCM => {
                    PositionV2Account::deserialize(&position_account.data)?
                }
                POSITION_V3_ACCOUNT_DISCM => DynamicPosition::deserialize(&position_account.data)?,
                _ => {
                    println!("Not a valid position account");
                    return Ok(());
                }
            };

            println!("{:#?}", position_state);
        }

        Command::ClaimReward {
            lb_pair,
            reward_index,
            position,
        } => {
            let params = ClaimRewardParams {
                lb_pair,
                reward_index,
                position,
            };
            claim_reward(params, &amm_program, transaction_config).await?;
        }
        Command::UpdateRewardDuration {
            lb_pair,
            reward_index,
            reward_duration,
        } => {
            let params = UpdateRewardDurationParams {
                lb_pair,
                reward_index,
                reward_duration,
            };
            update_reward_duration(params, &amm_program, transaction_config).await?;
        }
        Command::UpdateRewardFunder {
            lb_pair,
            reward_index,
            funder,
        } => {
            let params = UpdateRewardFunderParams {
                lb_pair,
                reward_index,
                funder,
            };
            update_reward_funder(params, &amm_program, transaction_config).await?;
        }
        Command::ClosePosition { position } => {
            close_position(position, &amm_program, transaction_config).await?;
        }
        Command::ClaimFee { position } => {
            claim_fee(position, &amm_program, transaction_config).await?;
        }
        Command::IncreaseLength {
            lb_pair,
            length_to_add,
        } => {
            let params = IncreaseLengthParams {
                lb_pair,
                length_to_add,
            };
            increase_length(params, &amm_program, transaction_config).await?;
        }

        Command::ShowPresetParameter { preset_parameter } => {
            let preset_param_state =
                rpc_client
                    .get_account(&preset_parameter)
                    .await
                    .and_then(|account| {
                        let disc = &account.data[0..8];
                        match disc {
                            PRESET_PARAMETER_ACCOUNT_DISCM => {
                                Ok(PresetParameterAccount::deserialize(&account.data)?.0)
                            }
                            PRESET_PARAMETER2_ACCOUNT_DISCM => {
                                Ok(PresetParameter2Account::deserialize(&account.data)?.0)
                            }
                            _ => Err(anyhow::anyhow!("Not a valid preset parameter account")),
                        }
                    })?;
            println!("{:#?}", preset_param_state);
        }

        Command::ListAllBinStep => {
            list_all_binstep(&amm_program).await?;
        }
        Command::SimulateSwapDemand {
            lb_pair,
            x_amount,
            y_amount,
            side_ratio,
        } => {
            let params = SimulateSwapDemandParameters {
                lb_pair,
                x_amount,
                y_amount,
                side_ratio,
            };
            simulate_swap_demand(params, &amm_program, transaction_config).await?;
        }
        Command::SwapExactOut {
            lb_pair,
            amount_out,
            swap_for_y,
        } => {
            let params = SwapExactOutParameters {
                lb_pair,
                amount_out,
                swap_for_y,
            };
            swap_exact_out(params, &amm_program, transaction_config).await?;
        }
        Command::SwapWithPriceImpact {
            lb_pair,
            amount_in,
            swap_for_y,
            price_impact_bps,
        } => {
            let params = SwapWithPriceImpactParameters {
                lb_pair,
                amount_in,
                swap_for_y,
                price_impact_bps,
            };
            swap_with_price_impact(params, &amm_program, transaction_config).await?;
        }
        Command::InitializeCustomizablePermissionlessLbPair {
            token_mint_x,
            token_mint_y,
            bin_step,
            initial_price,
            base_fee_bps,
            activation_type,
            has_alpha_vault,
            activation_point,
            selective_rounding,
        } => {
            let params = InitCustomizablePermissionlessLbPairParameters {
                token_mint_x,
                token_mint_y,
                bin_step,
                initial_price,
                base_fee_bps,
                activation_point,
                has_alpha_vault,
                activation_type,
                selective_rounding,
            };
            initialize_customizable_permissionless_lb_pair(
                params,
                &amm_program,
                transaction_config,
            )
            .await?;
        }
        Command::SeedLiquidity {
            lb_pair,
            base_position_path,
            amount,
            min_price,
            max_price,
            base_pubkey,
            curvature,
            position_owner_path,
            max_retries,
        } => {
            let mut retry_count = 0;
            loop {
                let position_base_kp = read_keypair_file(base_position_path.clone())
                    .expect("position base keypair file not found");

                let position_owner_kp = read_keypair_file(position_owner_path.clone())
                    .expect("position owner keypair file not found");

                let params = SeedLiquidityParameters {
                    lb_pair,
                    position_base_kp,
                    amount,
                    min_price,
                    max_price,
                    base_pubkey,
                    position_owner_kp,
                    curvature,
                };
                if let Err(err) = seed_liquidity(
                    params,
                    &amm_program,
                    transaction_config,
                    compute_unit_price_ix.clone(),
                )
                .await
                {
                    println!("Error: {}", err);
                    retry_count += 1;
                    if retry_count >= max_retries {
                        println!("Exceeded max retries {}", max_retries);
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(16)).await;
                } else {
                    break;
                }
            }
        }
        Command::SeedLiquidityByOperator {
            lb_pair,
            base_position_path,
            amount,
            min_price,
            max_price,
            base_pubkey,
            curvature,
            position_owner,
            fee_owner,
            lock_release_point,
            max_retries,
        } => {
            let mut retry_count = 0;
            loop {
                let position_base_kp = read_keypair_file(base_position_path.clone())
                    .expect("position base keypair file not found");

                let params = SeedLiquidityByOperatorParameters {
                    lb_pair,
                    position_base_kp,
                    amount,
                    min_price,
                    max_price,
                    base_pubkey,
                    position_owner,
                    fee_owner,
                    lock_release_point,
                    curvature,
                };
                if let Err(err) = seed_liquidity_by_operator(
                    params,
                    &amm_program,
                    transaction_config,
                    compute_unit_price_ix.clone(),
                )
                .await
                {
                    println!("Error: {}", err);
                    retry_count += 1;
                    if retry_count >= max_retries {
                        println!("Exceeded max retries {}", max_retries);
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(16)).await;
                } else {
                    break;
                }
            }
        }
        Command::SeedLiquiditySingleBin {
            lb_pair,
            base_position_path,
            base_pubkey,
            amount,
            price,
            position_owner_path,
            selective_rounding,
        } => {
            let position_base_kp = read_keypair_file(base_position_path)
                .expect("position base keypair file not found");

            let position_owner_kp = read_keypair_file(position_owner_path)
                .expect("position owner keypair file not found");

            let params = SeedLiquiditySingleBinParameters {
                lb_pair,
                position_base_kp,
                amount,
                price,
                base_pubkey,
                position_owner_kp,
                selective_rounding,
            };
            seed_liquidity_single_bin(
                params,
                &amm_program,
                transaction_config,
                compute_unit_price_ix,
            )
            .await?;
        }
        Command::SeedLiquiditySingleBinByOperator {
            lb_pair,
            base_position_path,
            base_pubkey,
            amount,
            price,
            position_owner,
            fee_owner,
            lock_release_point,
            selective_rounding,
        } => {
            let position_base_kp = read_keypair_file(base_position_path)
                .expect("position base keypair file not found");

            let params = SeedLiquiditySingleBinByOperatorParameters {
                lb_pair,
                position_base_kp,
                amount,
                price,
                base_pubkey,
                position_owner,
                fee_owner,
                lock_release_point,
                selective_rounding,
            };
            seed_liquidity_single_bin_by_operator(
                params,
                &amm_program,
                transaction_config,
                compute_unit_price_ix,
            )
            .await?;
        }
        Command::Admin(admin_command) => match admin_command {
            AdminCommand::InitializePermissionPair {
                bin_step,
                token_mint_x,
                token_mint_y,
                initial_price,
                base_keypair_path,
                base_fee_bps,
                lock_duration,
                activation_type,
            } => {
                let base_keypair =
                    read_keypair_file(base_keypair_path).expect("base keypair file not found");
                let params = InitPermissionLbPairParameters {
                    base_keypair,
                    bin_step,
                    initial_price,
                    token_mint_x,
                    token_mint_y,
                    base_fee_bps,
                    lock_duration,
                    activation_type,
                };
                initialize_permission_lb_pair(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::TogglePoolStatus { lb_pair } => {
                toggle_pool_status(lb_pair, &amm_program, transaction_config).await?;
            }
            AdminCommand::RemoveLiquidityByPriceRange {
                lb_pair,
                base_position_key,
                min_price,
                max_price,
            } => {
                let params = RemoveLiquidityByPriceRangeParameters {
                    lb_pair,
                    base_position_key,
                    min_price,
                    max_price,
                };
                remove_liquidity_by_price_range(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::CheckMyBalance {
                lb_pair,
                base_position_key,
                min_price,
                max_price,
            } => {
                let params = CheckMyBalanceParameters {
                    lb_pair,
                    base_position_key,
                    min_price,
                    max_price,
                };
                check_my_balance(params, &amm_program).await?;
            }
            AdminCommand::SetActivationPoint {
                activation_point,
                lb_pair,
            } => {
                let params = SetActivationPointParam {
                    activation_point,
                    lb_pair,
                };
                set_activation_point(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::ClosePresetParameter { preset_parameter } => {
                close_preset_parameter(preset_parameter, &amm_program, transaction_config).await?;
            }
            AdminCommand::InitializePresetParameter {
                bin_step,
                base_factor,
                filter_period,
                decay_period,
                reduction_factor,
                variable_fee_control,
                max_volatility_accumulator,
                min_bin_id,
                max_bin_id,
                protocol_share,
            } => {
                let params = InitPresetParameters {
                    base_factor,
                    bin_step,
                    decay_period,
                    filter_period,
                    max_bin_id,
                    max_volatility_accumulator,

                    min_bin_id,
                    protocol_share,
                    reduction_factor,
                    variable_fee_control,
                };
                initialize_preset_parameter(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::WithdrawProtocolFee {
                lb_pair,
                amount_x,
                amount_y,
            } => {
                let params = WithdrawProtocolFeeParams {
                    lb_pair,
                    amount_x,
                    amount_y,
                };
                withdraw_protocol_fee(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::FundReward {
                lb_pair,
                reward_index,
                funding_amount,
            } => {
                let params = FundRewardParams {
                    lb_pair,
                    reward_index,
                    funding_amount,
                };
                fund_reward(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::InitializeReward {
                lb_pair,
                reward_mint,
                reward_index,
                reward_duration,
                funder,
            } => {
                let params = InitializeRewardParams {
                    lb_pair,
                    reward_index,
                    reward_mint,
                    reward_duration,
                    funder,
                };
                initialize_reward(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::SetPreActivationSwapAddress {
                lb_pair,
                pre_activation_swap_address,
            } => {
                let params = SetPreactivationSwapAddressParam {
                    lb_pair,
                    pre_activation_swap_address,
                };
                set_pre_activation_swap_address(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::SetPreActivationDuration {
                lb_pair,
                pre_activation_duration,
            } => {
                let params = SetPreactivationDurationParam {
                    lb_pair,
                    pre_activation_duration,
                };
                set_pre_activation_duration(params, &amm_program, transaction_config).await?;
            }
        },
    };

    Ok(())
}
