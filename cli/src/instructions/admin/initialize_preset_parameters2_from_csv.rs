use std::fs;
use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::signer::Signer, Program};

use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_lang::ToAccountMetas;
use anyhow::*;
use clap::Parser;
use commons::dlmm::accounts::{PresetParameter, PresetParameter2};
use commons::dlmm::constants::PROTOCOL_SHARE;
use commons::dlmm::types::InitPresetParameters2Ix;
use commons::{derive_preset_parameter_pda_v2, dlmm, FEE_PRECISION};

use crate::math::compute_base_factor_from_fee_bps;

#[derive(Debug, Parser)]
pub struct InitPresetParameterFromCsvParams {
    csv_file_path: String,
}

#[allow(dead_code)]
struct PresetParameterInfo {
    pubkey: Pubkey,
    bin_step: u16,
    base_factor: u16,
    base_power_factor: u8,
    filter_period: u16,
    decay_period: u16,
    reduction_factor: u16,
    variable_fee_control: u32,
    max_volatility_accumulator: u32,
}

impl PresetParameterInfo {
    pub fn from_preset_parameter(preset_param: PresetParameter, pubkey: Pubkey) -> Self {
        Self {
            pubkey,
            bin_step: preset_param.bin_step,
            base_factor: preset_param.base_factor,
            base_power_factor: 0,
            filter_period: preset_param.filter_period,
            decay_period: preset_param.decay_period,
            reduction_factor: preset_param.reduction_factor,
            variable_fee_control: preset_param.variable_fee_control,
            max_volatility_accumulator: preset_param.max_volatility_accumulator,
        }
    }

    pub fn from_preset_parameter2(preset_param: PresetParameter2, pubkey: Pubkey) -> Self {
        Self {
            pubkey,
            bin_step: preset_param.bin_step,
            base_factor: preset_param.base_factor,
            filter_period: preset_param.filter_period,
            decay_period: preset_param.decay_period,
            reduction_factor: preset_param.reduction_factor,
            variable_fee_control: preset_param.variable_fee_control,
            max_volatility_accumulator: preset_param.max_volatility_accumulator,
            base_power_factor: preset_param.base_fee_power_factor,
        }
    }

    #[allow(dead_code)]
    pub fn get_base_fee_pct(&self) -> f64 {
        (self.bin_step as u128 * self.base_factor as u128 * 1000) as f64 / FEE_PRECISION as f64
    }
}

pub async fn execute_initialize_preset_parameter_from_csv<
    C: Deref<Target = impl Signer> + Clone,
>(
    params: InitPresetParameterFromCsvParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let InitPresetParameterFromCsvParams { csv_file_path } = params;

    let preset_parameters = program.accounts::<PresetParameter>(vec![]).await?;
    let preset_parameters2 = program.accounts::<PresetParameter2>(vec![]).await?;
    let mut pp_2_index = preset_parameters2.len();

    let mut preset_parameter_info: Vec<PresetParameterInfo> = vec![];

    for (pubkey, preset_param) in preset_parameters.into_iter() {
        preset_parameter_info.push(PresetParameterInfo::from_preset_parameter(
            preset_param,
            pubkey,
        ));
    }

    for (pubkey, preset_param) in preset_parameters2.into_iter() {
        preset_parameter_info.push(PresetParameterInfo::from_preset_parameter2(
            preset_param,
            pubkey,
        ));
    }

    // for preset_param in preset_parameter_info.iter() {
    //     println!(
    //         "Bin step: {}. Fee pct: {}%",
    //         preset_param.bin_step,
    //         preset_param.get_base_fee_pct()
    //     );
    // }

    let content: String = fs::read_to_string(csv_file_path)?;
    let fee_pct_to_bin_step_combos = content.split('\n');

    for combo in fee_pct_to_bin_step_combos {
        let fee_pct_and_bin_step = combo.split(',').collect::<Vec<&str>>();
        let fee_pct = fee_pct_and_bin_step[0].trim().parse::<f64>()?;
        let bin_step = fee_pct_and_bin_step[1].trim().parse::<u16>()?;

        let fee_bps = (fee_pct * 100.0) as u16;
        assert_eq!(fee_bps as f64, fee_pct * 100.0); // Ensure no decimal place

        let base_factor =
            compute_base_factor_from_fee_bps(bin_step, fee_bps).map_err(|e| println!("ERROR: {e}"));

        let std::result::Result::Ok((base_factor, base_power_factor)) = base_factor else {
            continue;
        };

        let existed = preset_parameter_info.iter().any(|info| {
            info.bin_step == bin_step
                && info.base_factor == base_factor
                && info.base_power_factor == base_power_factor
        });

        if existed {
            println!(
                "Bin step {}. Fee pct {}% exists. Skipping ...",
                bin_step, fee_pct
            );
            continue;
        }

        let mut min_diff = i32::MAX;
        let mut min_idx = usize::MAX;
        for (idx, exists_pp) in preset_parameter_info.iter().enumerate() {
            let diff = (exists_pp.bin_step as i32 - bin_step as i32).abs();
            if diff < min_diff {
                min_diff = diff;
                min_idx = idx;
            }
        }

        let closest_preset_param = &preset_parameter_info[min_idx];

        let ix = dlmm::client::args::InitializePresetParameter2 {
            ix: InitPresetParameters2Ix {
                index: pp_2_index as u16,
                bin_step,
                base_factor,
                filter_period: closest_preset_param.filter_period,
                decay_period: closest_preset_param.decay_period,
                reduction_factor: closest_preset_param.reduction_factor,
                variable_fee_control: closest_preset_param.variable_fee_control,
                max_volatility_accumulator: closest_preset_param.max_volatility_accumulator,
                protocol_share: PROTOCOL_SHARE,
                base_fee_power_factor: base_power_factor,
            },
        };

        let preset_param_pda = derive_preset_parameter_pda_v2(pp_2_index as u16).0;
        pp_2_index += 1;

        let accounts = dlmm::client::accounts::InitializePresetParameter2 {
            preset_parameter: preset_param_pda,
            admin: program.payer(),
            system_program: anchor_client::solana_sdk::system_program::ID,
        }
        .to_account_metas(None);

        let request_builder = program.request();

        let signature = request_builder
            .accounts(accounts)
            .args(ix)
            .send_with_spinner_and_config(transaction_config)
            .await;

        println!("Creating bin step {}. Fee pct {}%", bin_step, fee_pct);

        println!(
            "Initialize preset parameter {}. Signature: {signature:#?}",
            preset_param_pda
        );

        signature?;
    }
    Ok(())
}
