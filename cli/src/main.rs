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
use crate::instructions::add_liquidity::*;
use crate::instructions::claim_fee::*;
use crate::instructions::claim_reward::*;
use crate::instructions::close_position::*;
use crate::instructions::increase_length::*;
use crate::instructions::initialize_bin_array::*;
use crate::instructions::initialize_bin_array_with_bin_range::*;
use crate::instructions::initialize_position::*;
use crate::instructions::remove_liquidity::*;
use crate::instructions::swap::*;
use args::Command;
use args::*;

fn main() -> Result<()> {
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

    let amm_program = client.program(dlmm_program_interface::ID).unwrap();

    let transaction_config: RpcSendTransactionConfig = RpcSendTransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(commitment_config.commitment),
        encoding: None,
        max_retries: None,
        min_context_slot: None,
    };

    match cli.command {
        Command::InitializeBinArray {
            bin_array_index,
            lb_pair,
        } => {
            let params = InitBinArrayParameters {
                bin_array_index,
                lb_pair,
            };
            initialize_bin_array(params, &amm_program, transaction_config)?;
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
            initialize_bin_array_with_bin_range(params, &amm_program, transaction_config)?;
        }
        Command::InitializePosition {
            lb_pair,
            lower_bin_id,
            width,
        } => {
            let params = InitPositionParameters {
                lb_pair,
                lower_bin_id,
                width,
            };
            initialize_position(params, &amm_program, transaction_config)?;
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
            add_liquidity(params, &amm_program, transaction_config)?;
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
            remove_liquidity(params, &amm_program, transaction_config)?;
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
            swap(params, &amm_program, transaction_config)?;
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
            claim_reward(params, &amm_program, transaction_config)?;
        }
        Command::ClosePosition { position } => {
            close_position(position, &amm_program, transaction_config)?;
        }
        Command::ClaimFee { position } => {
            claim_fee(position, &amm_program, transaction_config)?;
        }
        Command::IncreaseLength {
            lb_pair,
            length_to_add,
        } => {
            let params = IncreaseLengthParams {
                lb_pair,
                length_to_add,
            };
            increase_length(params, &amm_program, transaction_config)?;
        }
    };

    Ok(())
}
