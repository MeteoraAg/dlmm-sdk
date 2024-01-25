use std::rc::Rc;

use anchor_client::Client;
use anchor_client::{
    solana_client::rpc_config::RpcSendTransactionConfig,
    solana_sdk::{
        commitment_config::CommitmentConfig,
        signer::{keypair::*, Signer},
    },
};
use anyhow::*;
use clap::*;

mod args;
mod instructions;
mod math;

use args::*;
use instructions::initialize_lb_pair::*;
use lb_clmm::state::preset_parameters::PresetParameter;
use lb_clmm::utils::pda::derive_preset_parameter_pda;

use crate::instructions::initialize_bin_array_with_bin_range::{
    initialize_bin_array_with_bin_range, InitBinArrayWithBinRangeParameters,
};
use crate::instructions::initialize_position_with_price_range::{
    initialize_position_with_price_range, InitPositionWithPriceRangeParameters,
};
use crate::instructions::initialize_preset_parameter::InitPresetParameters;
use crate::{
    args::Command,
    instructions::{
        add_liquidity::{add_liquidity, AddLiquidityParam},
        check_my_balance::{check_my_balance, CheckMyBalanceParameters},
        claim_fee::claim_fee,
        claim_reward::*,
        close_position::close_position,
        close_preset_parameter::close_preset_parameter,
        fund_reward::*,
        increase_length::{increase_length, IncreaseLengthParams},
        initialize_bin_array::{initialize_bin_array, InitBinArrayParameters},
        initialize_bin_array_with_price_range::{
            initialize_bin_array_with_price_range, InitBinArrayWithPriceRangeParameters,
        },
        initialize_position::{initialize_position, InitPositionParameters},
        initialize_preset_parameter::initialize_preset_parameter,
        initialize_reward::*,
        list_all_binstep::list_all_binstep,
        remove_liquidity::{remove_liquidity, RemoveLiquidityParameters},
        remove_liquidity_by_price_range::{
            remove_liquidity_by_price_range, RemoveLiquidityByPriceRangeParameters,
        },
        seed_liquidity::{seed_liquidity, SeedLiquidityParameters},
        show_pair::show_pair,
        simulate_swap_demand::{simulate_swap_demand, SimulateSwapDemandParameters},
        swap::{swap, SwapParameters},
        toggle_pair_status::toggle_pool_status,
        update_fee_owner::{update_fee_owner, UpdateFeeOwnerParam},
        update_reward_duration::*,
        update_reward_funder::*,
        update_whitelisted_wallet::update_whitelisted_wallet,
        withdraw_protocol_fee::{withdraw_protocol_fee, WithdrawProtocolFeeParams},
    },
};
use lb_clmm::utils::pda::derive_lb_pair_pda;

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

    let amm_program = client.program(lb_clmm::ID).unwrap();

    let transaction_config: RpcSendTransactionConfig = RpcSendTransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(commitment_config.commitment),
        encoding: None,
        max_retries: None,
        min_context_slot: None,
    };

    match cli.command {
        Command::InitializePair {
            initial_price,
            bin_step,
            token_mint_x,
            token_mint_y,
            permission,
        } => {
            let params = InitLbPairParameters {
                token_mint_x,
                token_mint_y,
                bin_step,
                initial_price,
                permission,
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
            add_liquidity(params, &amm_program, transaction_config).await?;
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
        Command::Swap {
            lb_pair,
            amount_in,
            swap_for_y,
        } => {
            let params = SwapParameters {
                amount_in,
                lb_pair,
                swap_for_y,
            };
            swap(params, &amm_program, transaction_config).await?;
        }
        Command::WithdrawProtocolFee {
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
        Command::UpdateFeeOwner { lb_pair, fee_owner } => {
            let params = UpdateFeeOwnerParam { fee_owner, lb_pair };
            update_fee_owner(params, &amm_program, transaction_config).await?;
        }
        Command::ShowPair { lb_pair } => {
            show_pair(lb_pair, &amm_program).await?;
        }
        Command::ShowPosition { position } => {
            let position: lb_clmm::state::position::Position = amm_program.account(position).await?;
            println!("{:#?}", position);
        }
        Command::InitializeReward {
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
        Command::FundReward {
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
        Command::InitializePresetParameter {
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
        Command::ClosePresetParameter { bin_step } => {
            close_preset_parameter(bin_step, &amm_program, transaction_config).await?;
        }
        Command::ShowPresetParameter { bin_step } => {
            let (preset_param_pda, _bump) = derive_preset_parameter_pda(bin_step);
            let preset_param_state: PresetParameter = amm_program.account(preset_param_pda).await?;
            println!("{:#?}", preset_param_state);
        }
        Command::UpdateWhitelistedWallet {
            lb_pair,
            wallet_address,
            idx,
        } => update_whitelisted_wallet(
            lb_pair,
            idx,
            wallet_address,
            &amm_program,
            transaction_config,
        ).await?,
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
        Command::Admin(admin_command) => match admin_command {
            AdminCommand::TogglePoolStatus { lb_pair } => {
                toggle_pool_status(lb_pair, &amm_program, transaction_config).await?;
            }
            AdminCommand::TogglePoolStatus2 {
                bin_step,
                permission,
                token_mint_x,
                token_mint_y,
            } => {
                let (lb_pair, _bump) =
                    derive_lb_pair_pda(token_mint_x, token_mint_y, bin_step, permission);
                toggle_pool_status(lb_pair, &amm_program, transaction_config).await?;
            }
            AdminCommand::UpdateWhitelistedWallet2 {
                bin_step,
                token_mint_x,
                token_mint_y,
                permission,
                wallet_address,
                idx,
            } => {
                let (lb_pair, _bump) =
                    derive_lb_pair_pda(token_mint_x, token_mint_y, bin_step, permission);
                update_whitelisted_wallet(
                    lb_pair,
                    idx,
                    wallet_address,
                    &amm_program,
                    transaction_config,
                ).await?;
            }
            AdminCommand::SeedLiquidity {
                bin_step,
                permission,
                base_position_path,
                token_mint_x,
                token_mint_y,
                amount,
                min_price,
                max_price,
            } => {
                let position_base_kp = read_keypair_file(base_position_path)
                    .expect("position base keypair file not found");
                let params = SeedLiquidityParameters {
                    bin_step,
                    permission,
                    position_base_kp,
                    token_mint_x,
                    token_mint_y,
                    amount,
                    min_price,
                    max_price,
                };
                seed_liquidity(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::RemoveLiquidityByPriceRange {
                bin_step,
                permission,
                base_position_key,
                token_mint_x,
                token_mint_y,
                min_price,
                max_price,
            } => {
                let params = RemoveLiquidityByPriceRangeParameters {
                    bin_step,
                    permission,
                    base_position_key,
                    token_mint_x,
                    token_mint_y,
                    min_price,
                    max_price,
                };
                remove_liquidity_by_price_range(params, &amm_program, transaction_config).await?;
            }
            AdminCommand::CheckMyBalance {
                bin_step,
                permission,
                base_position_key,
                token_mint_x,
                token_mint_y,
                min_price,
                max_price,
            } => {
                let params = CheckMyBalanceParameters {
                    bin_step,
                    permission,
                    base_position_key,
                    token_mint_x,
                    token_mint_y,
                    min_price,
                    max_price,
                };
                check_my_balance(params, &amm_program).await?;
            }
        },
    };

    Ok(())
}
