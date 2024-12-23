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

    let program = client.program(dlmm_interface::ID).unwrap();

    let rpc_client = program.async_rpc();

    let transaction_config: RpcSendTransactionConfig = RpcSendTransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(commitment_config.commitment),
        encoding: None,
        max_retries: None,
        min_context_slot: None,
    };

    let compute_unit_price_ix = get_set_compute_unit_price_ix(cli.config_override.priority_fee);

    match cli.command {
        DLMMCommand::InitializePair(params) => {
            execute_initialize_lb_pair(params, &program, transaction_config).await?;
        }
        DLMMCommand::InitializeBinArray(params) => {
            execute_initialize_bin_array(params, &program, transaction_config).await?;
        }
        DLMMCommand::InitializeBinArrayWithPriceRange(params) => {
            execute_initialize_bin_array_with_price_range(params, &program, transaction_config)
                .await?;
        }
        DLMMCommand::InitializeBinArrayWithBinRange(params) => {
            execute_initialize_bin_array_with_bin_range(params, &program, transaction_config)
                .await?;
        }
        DLMMCommand::InitializePositionWithPriceRange(params) => {
            execute_initialize_position_with_price_range(params, &program, transaction_config)
                .await?;
        }
        DLMMCommand::InitializePosition(params) => {
            execute_initialize_position(params, &program, transaction_config).await?;
        }
        DLMMCommand::AddLiquidity(params) => {
            execute_add_liquidity(params, &program, transaction_config).await?;
        }
        DLMMCommand::RemoveLiquidity(params) => {
            execute_remove_liquidity(params, &program, transaction_config).await?;
        }
        DLMMCommand::SwapExactIn(params) => {
            execute_swap(params, &program, transaction_config).await?;
        }

        DLMMCommand::ShowPair(params) => {
            execute_show_pair(params, &program).await?;
        }
        DLMMCommand::ShowPosition { position } => {
            let position_account = rpc_client.get_account(&position).await?;

            let mut disc = [0u8; 8];
            disc.copy_from_slice(&position_account.data[..8]);

            match disc {
                POSITION_ACCOUNT_DISCM => {
                    let position_state = PositionAccount::deserialize(&position_account.data)?.0;
                    println!("{:#?}", position_state);
                }
                POSITION_V2_ACCOUNT_DISCM => {
                    let position_state = PositionV2Account::deserialize(&position_account.data)?.0;
                    println!("{:#?}", position_state);
                }
                POSITION_V3_ACCOUNT_DISCM => {
                    let position_state = DynamicPosition::deserialize(&position_account.data)?;
                    println!("{:#?}", position_state);
                }
                _ => {
                    bail!("Not a valid position account");
                }
            };
        }

        DLMMCommand::ClaimReward(params) => {
            execute_claim_reward(params, &program, transaction_config).await?;
        }
        DLMMCommand::UpdateRewardDuration(params) => {
            execute_update_reward_duration(params, &program, transaction_config).await?;
        }
        DLMMCommand::UpdateRewardFunder(params) => {
            execute_update_reward_funder(params, &program, transaction_config).await?;
        }
        DLMMCommand::ClosePosition(params) => {
            execute_close_position(params, &program, transaction_config).await?;
        }
        DLMMCommand::ClaimFee(params) => {
            execute_claim_fee(params, &program, transaction_config).await?;
        }
        DLMMCommand::IncreaseLength(params) => {
            execute_increase_length(params, &program, transaction_config).await?;
        }

        DLMMCommand::ShowPresetParameter { preset_parameter } => {
            let account = rpc_client.get_account(&preset_parameter).await?;

            let mut disc = [0u8; 8];
            disc.copy_from_slice(&account.data[..8]);

            match disc {
                PRESET_PARAMETER_ACCOUNT_DISCM => {
                    let preset_param_state = PresetParameterAccount::deserialize(&account.data)?.0;
                    println!("{:#?}", preset_param_state);
                }
                PRESET_PARAMETER2_ACCOUNT_DISCM => {
                    let preset_param_state = PresetParameter2Account::deserialize(&account.data)?.0;
                    println!("{:#?}", preset_param_state);
                }
                _ => bail!("Not a valid preset parameter account"),
            }
        }

        DLMMCommand::ListAllBinStep => {
            execute_list_all_bin_step(&program).await?;
        }
        DLMMCommand::SwapExactOut(params) => {
            execute_swap_exact_out(params, &program, transaction_config).await?;
        }
        DLMMCommand::SwapWithPriceImpact(params) => {
            execute_swap_with_price_impact(params, &program, transaction_config).await?;
        }
        DLMMCommand::InitializeCustomizablePermissionlessLbPair(params) => {
            execute_initialize_customizable_permissionless_lb_pair(
                params,
                &program,
                transaction_config,
            )
            .await?;
        }
        DLMMCommand::SeedLiquidity {
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
                if let Err(err) = execute_seed_liquidity(
                    params,
                    &program,
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
        DLMMCommand::SeedLiquidityByOperator {
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
                if let Err(err) = execute_seed_liquidity_by_operator(
                    params,
                    &program,
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
        DLMMCommand::SeedLiquiditySingleBin {
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
            execute_seed_liquidity_single_bin(
                params,
                &program,
                transaction_config,
                compute_unit_price_ix,
            )
            .await?;
        }
        DLMMCommand::SeedLiquiditySingleBinByOperator {
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
            execute_seed_liquidity_single_bin_by_operator(
                params,
                &program,
                transaction_config,
                compute_unit_price_ix,
            )
            .await?;
        }
        DLMMCommand::Admin(command) => match command {
            AdminCommand::InitializePermissionPair {
                bin_step,
                token_mint_x,
                token_mint_y,
                initial_price,
                base_keypair_path,
                base_fee_bps,
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
                    activation_type,
                };
                execute_initialize_permission_lb_pair(params, &program, transaction_config).await?;
            }
            AdminCommand::TogglePoolStatus { lb_pair } => {
                execute_toggle_pool_status(lb_pair, &program, transaction_config).await?;
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
                execute_remove_liquidity_by_price_range(params, &program, transaction_config)
                    .await?;
            }
            AdminCommand::SetActivationPoint {
                activation_point,
                lb_pair,
            } => {
                let params = SetActivationPointParam {
                    activation_point,
                    lb_pair,
                };
                execute_set_activation_point(params, &program, transaction_config).await?;
            }
            AdminCommand::ClosePresetParameter { preset_parameter } => {
                execute_close_preset_parameter(preset_parameter, &program, transaction_config)
                    .await?;
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
                base_fee_power_factor,
            } => {
                let params = InitPresetParameters {
                    base_factor,
                    bin_step,
                    decay_period,
                    filter_period,
                    max_volatility_accumulator,
                    protocol_share,
                    reduction_factor,
                    variable_fee_control,
                    base_fee_power_factor,
                };
                execute_initialize_preset_parameter(params, &program, transaction_config).await?;
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
                execute_withdraw_protocol_fee(params, &program, transaction_config).await?;
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
                execute_fund_reward(params, &program, transaction_config).await?;
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
                execute_initialize_reward(params, &program, transaction_config).await?;
            }
            AdminCommand::SetPreActivationSwapAddress {
                lb_pair,
                pre_activation_swap_address,
            } => {
                let params = SetPreactivationSwapAddressParam {
                    lb_pair,
                    pre_activation_swap_address,
                };
                execute_set_pre_activation_swap_address(params, &program, transaction_config)
                    .await?;
            }
            AdminCommand::SetPreActivationDuration {
                lb_pair,
                pre_activation_duration,
            } => {
                let params = SetPreactivationDurationParam {
                    lb_pair,
                    pre_activation_duration,
                };
                execute_set_pre_activation_duration(params, &program, transaction_config).await?;
            }
        },
    };

    Ok(())
}
