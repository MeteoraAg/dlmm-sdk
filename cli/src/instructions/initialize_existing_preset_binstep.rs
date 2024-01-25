use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::signer::Signer, Program};

use anchor_lang::ToAccountMetas;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::instructions::initialize_preset_parameters::InitPresetParametersIx;
use lb_clmm::state::preset_parameters::PresetParameter;
use lb_clmm::utils::pda::derive_preset_parameter_pda;

pub const existing_preset_parameters: [PresetParameter; 10] = [
    PresetParameter {
        bin_step: 1,
        base_factor: 20000,
        filter_period: 10,
        decay_period: 120,
        reduction_factor: 5000,
        variable_fee_control: 2000000,
        protocol_share: 0,
        max_volatility_accumulator: 100000,
        max_bin_id: 436704,
        min_bin_id: -436704,
    },
    PresetParameter {
        bin_step: 2,
        base_factor: 15000,
        filter_period: 10,
        decay_period: 120,
        reduction_factor: 5000,
        variable_fee_control: 500000,
        protocol_share: 0,
        max_bin_id: 218363,
        min_bin_id: -218363,
        max_volatility_accumulator: 250000,
    },
    PresetParameter {
        bin_step: 5,
        base_factor: 8000,
        filter_period: 30,
        decay_period: 600,
        reduction_factor: 5000,
        variable_fee_control: 120000,
        protocol_share: 0,
        max_bin_id: 87358,
        min_bin_id: -87358,
        max_volatility_accumulator: 300000,
    },
    PresetParameter {
        bin_step: 8,
        base_factor: 6250,
        filter_period: 30,
        decay_period: 600,
        reduction_factor: 5000,
        variable_fee_control: 120000,
        protocol_share: 0,
        max_bin_id: 54190,
        min_bin_id: -54190,
        max_volatility_accumulator: 300000,
    },
    PresetParameter {
        bin_step: 10,
        base_factor: 10000,
        filter_period: 30,
        decay_period: 600,
        reduction_factor: 5000,
        variable_fee_control: 40000,
        protocol_share: 0,
        max_bin_id: 43690,
        min_bin_id: -43690,
        max_volatility_accumulator: 350000,
    },
    PresetParameter {
        bin_step: 15,
        base_factor: 10000,
        filter_period: 30,
        decay_period: 600,
        reduction_factor: 5000,
        variable_fee_control: 30000,
        protocol_share: 0,
        max_bin_id: 29134,
        min_bin_id: -29134,
        max_volatility_accumulator: 350000,
    },
    PresetParameter {
        bin_step: 20,
        base_factor: 10000,
        filter_period: 30,
        decay_period: 600,
        reduction_factor: 5000,
        variable_fee_control: 20000,
        protocol_share: 0,
        max_bin_id: 21855,
        min_bin_id: -21855,
        max_volatility_accumulator: 350000,
    },
    PresetParameter {
        bin_step: 25,
        base_factor: 10000,
        filter_period: 30,
        decay_period: 600,
        reduction_factor: 5000,
        variable_fee_control: 15000,
        protocol_share: 0,
        max_bin_id: 17481,
        min_bin_id: -17481,
        max_volatility_accumulator: 350000,
    },
    PresetParameter {
        bin_step: 50,
        base_factor: 8000,
        filter_period: 120,
        decay_period: 1200,
        reduction_factor: 5000,
        variable_fee_control: 10000,
        protocol_share: 0,
        max_bin_id: 8754,
        min_bin_id: -8754,
        max_volatility_accumulator: 250000,
    },
    PresetParameter {
        bin_step: 100,
        base_factor: 8000,
        filter_period: 300,
        decay_period: 1200,
        reduction_factor: 5000,
        variable_fee_control: 7500,
        protocol_share: 0,
        max_bin_id: 4386,
        min_bin_id: -4386,
        max_volatility_accumulator: 150000,
    },
];

pub async fn initialize_existing_preset_binstep<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    for preset_value in existing_preset_parameters {
        let (preset_param_pda, _bump) = derive_preset_parameter_pda(preset_value.bin_step);

        if let Err(_) = program.rpc().get_account_data(&preset_param_pda) {
            let accounts = accounts::InitializePresetParameter {
                admin: program.payer(),
                preset_parameter: preset_param_pda,
                system_program: anchor_client::solana_sdk::system_program::ID,
                rent: anchor_client::solana_sdk::sysvar::rent::ID,
            }
            .to_account_metas(None);

            let ix = instruction::InitializePresetParameter {
                ix: InitPresetParametersIx {
                    base_factor: preset_value.base_factor,
                    bin_step: preset_value.bin_step,
                    decay_period: preset_value.decay_period,
                    filter_period: preset_value.filter_period,
                    max_bin_id: preset_value.max_bin_id,
                    max_volatility_accumulator: preset_value.max_volatility_accumulator,
                    min_bin_id: preset_value.min_bin_id,
                    protocol_share: preset_value.protocol_share,
                    reduction_factor: preset_value.reduction_factor,
                    variable_fee_control: preset_value.variable_fee_control,
                },
            };

            let request_builder = program.request();
            let signature = request_builder
                .accounts(accounts)
                .args(ix)
                .send_with_spinner_and_config(transaction_config).await;

            println!(
                "Initialize preset param {preset_param_pda} bin_step. Signature: {signature:#?}"
            );

            signature?;
        }
    }

    Ok(())
}
