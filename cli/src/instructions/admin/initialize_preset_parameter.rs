use anchor_lang::Discriminator;
use commons::dlmm::{accounts::PresetParameter2, types::InitPresetParameters2Ix};
use solana_client::{
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};

use crate::*;

#[derive(Debug, Parser)]
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
    /// Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
    pub protocol_share: u16,
    /// Base fee power factor  
    pub base_fee_power_factor: u8,
}

pub async fn execute_initialize_preset_parameter<C: Deref<Target = impl Signer> + Clone>(
    params: InitPresetParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPresetParameters {
        base_factor,
        bin_step,
        decay_period,
        filter_period,
        max_volatility_accumulator,
        protocol_share,
        reduction_factor,
        variable_fee_control,
        base_fee_power_factor,
    } = params;

    let rpc_client = program.rpc();

    let preset_parameter_v2_count = rpc_client
        .get_program_accounts_with_config(
            &dlmm::ID,
            RpcProgramAccountsConfig {
                filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
                    0,
                    &PresetParameter2::DISCRIMINATOR,
                ))]),
                account_config: RpcAccountInfoConfig {
                    encoding: Some(UiAccountEncoding::Base64),
                    data_slice: Some(UiDataSliceConfig {
                        offset: 0,
                        length: 0,
                    }),
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .await?
        .len();

    let index = preset_parameter_v2_count as u16;

    let (preset_parameter, _bump) =
        derive_preset_parameter_pda_v2(preset_parameter_v2_count as u16);

    let accounts = dlmm::client::accounts::InitializePresetParameter2 {
        preset_parameter,
        admin: program.payer(),
        system_program: solana_sdk::system_program::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::InitializePresetParameter2 {
        ix: InitPresetParameters2Ix {
            index,
            bin_step,
            base_factor,
            filter_period,
            decay_period,
            reduction_factor,
            variable_fee_control,
            max_volatility_accumulator,
            protocol_share,
            base_fee_power_factor,
        },
    }
    .data();

    let init_preset_param_ix = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(init_preset_param_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Initialize preset parameter {}. Signature: {signature:#?}",
        preset_parameter
    );

    signature?;

    Ok(preset_parameter)
}
