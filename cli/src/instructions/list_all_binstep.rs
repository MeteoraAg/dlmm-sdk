use solana_client::{
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};

use crate::*;

pub async fn execute_list_all_bin_step<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
) -> Result<()> {
    let rpc_client = program.async_rpc();

    let account_config = RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        data_slice: Some(UiDataSliceConfig {
            offset: 0,
            length: 0,
        }),
        ..Default::default()
    };

    let preset_parameter_keys = rpc_client
        .get_program_accounts_with_config(
            &dlmm_interface::ID,
            RpcProgramAccountsConfig {
                filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
                    0,
                    &PRESET_PARAMETER_ACCOUNT_DISCM,
                ))]),
                account_config: account_config.clone(),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|(key, _)| key)
        .collect::<Vec<_>>();

    let preset_parameter_v2_keys = rpc_client
        .get_program_accounts_with_config(
            &dlmm_interface::ID,
            RpcProgramAccountsConfig {
                filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
                    0,
                    &PRESET_PARAMETER2_ACCOUNT_DISCM,
                ))]),
                account_config,
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|(key, _)| key)
        .collect::<Vec<_>>();

    let all_versioned_keys = [preset_parameter_keys, preset_parameter_v2_keys].concat();

    for keys in all_versioned_keys.chunks(100) {
        let accounts = rpc_client.get_multiple_accounts(keys).await?;
        for (key, account) in keys.iter().zip(accounts) {
            if let Some(account) = account {
                let mut disc = [0u8; 8];
                disc.copy_from_slice(&account.data[..8]);

                let (bin_step, base_factor, base_fee_power_factor) = match disc {
                    PRESET_PARAMETER_ACCOUNT_DISCM => {
                        let state = PresetParameterAccount::deserialize(&account.data)?.0;
                        (state.bin_step, state.base_factor, 0)
                    }
                    PRESET_PARAMETER2_ACCOUNT_DISCM => {
                        let state = PresetParameter2Account::deserialize(&account.data)?.0;
                        (
                            state.bin_step,
                            state.base_factor,
                            state.base_fee_power_factor,
                        )
                    }
                    _ => continue,
                };

                let base_fee = (u128::from(bin_step)
                    * u128::from(base_factor).pow(base_fee_power_factor.into())
                    * 1000) as f64
                    / FEE_PRECISION as f64;

                println!(
                    "Preset Pubkey: {}. Bin step {}. Base fee: {}%",
                    key, bin_step, base_fee
                );
            }
        }
    }

    Ok(())
}
