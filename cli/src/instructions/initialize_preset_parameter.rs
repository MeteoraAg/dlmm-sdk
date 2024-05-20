use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_lang::ToAccountMetas;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::instructions::initialize_preset_parameters::InitPresetParametersIx;
use lb_clmm::utils::pda::derive_preset_parameter_pda2;

#[derive(Debug)]
pub struct InitPresetParameters {
    /// Bin step. Represent the price increment / decrement.
    pub bin_step: u16,
    /// Used for base fee calculation. base_fee_rate = base_factor * bin_step
    pub base_factor: u16,
    /// Filter period determine high frequency trading time window.
    pub filter_period: u16,
    /// Decay period determine when the volatile fee start decay / decrease.
    pub decay_period: u16,
    /// Reduction factor controls the volatile fee rate decrement rate.
    pub reduction_factor: u16,
    /// Used to scale the variable fee component depending on the dynamic of the market
    pub variable_fee_control: u32,
    /// Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
    pub max_volatility_accumulator: u32,
    /// Min bin id supported by the pool based on the configured bin step.
    pub min_bin_id: i32,
    /// Max bin id supported by the pool based on the configured bin step.
    pub max_bin_id: i32,
    /// Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
    pub protocol_share: u16,
}

pub async fn initialize_preset_parameter<C: Deref<Target = impl Signer> + Clone>(
    params: InitPresetParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPresetParameters {
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
    } = params;

    let (preset_parameter, _bump) = derive_preset_parameter_pda2(bin_step, base_factor);

    let accounts = accounts::InitializePresetParameter {
        preset_parameter,
        admin: program.payer(),
        rent: anchor_client::solana_sdk::sysvar::rent::ID,
        system_program: anchor_client::solana_sdk::system_program::ID,
    }
    .to_account_metas(None);

    let ix = instruction::InitializePresetParameter {
        ix: InitPresetParametersIx {
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
        },
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Initialize preset parameter {}. Signature: {signature:#?}",
        preset_parameter
    );

    signature?;

    Ok(preset_parameter)
}
