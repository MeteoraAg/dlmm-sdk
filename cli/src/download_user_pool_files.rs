use std::collections::HashSet;

use crate::*;
use serde::Serialize;
use solana_client::{nonblocking::rpc_client::RpcClient, rpc_config::*};
use solana_sdk::account::ReadableAccount;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RpcKeyedAccount {
    pub pubkey: String,
    pub account: UiAccount,
}

impl RpcKeyedAccount {
    pub fn new<T: ReadableAccount>(pubkey: &Pubkey, account: &T) -> Self {
        Self {
            pubkey: pubkey.to_string(),
            account: UiAccount::encode(pubkey, account, UiAccountEncoding::Base64, None, None),
        }
    }
}

#[derive(Parser, Debug)]
pub struct DownloadUserPoolFilesParams {
    #[clap(long)]
    output_path: String,
    #[clap(long)]
    wallet_key: Pubkey,
    #[clap(long)]
    pool_key: Pubkey,
    #[clap(long)]
    override_wallet_key: Option<Pubkey>,
}

async fn get_bin_array_and_position_keys(
    rpc_client: &RpcClient,
    wallet_key: Pubkey,
    pool_key: Pubkey,
) -> Result<Vec<Pubkey>> {
    let config = RpcProgramAccountsConfig {
        filters: Some(position_filter_by_wallet_and_pair(wallet_key, pool_key)),
        account_config: RpcAccountInfoConfig {
            encoding: Some(UiAccountEncoding::Base64),
            ..Default::default()
        },
        ..Default::default()
    };

    let position_key_with_accounts = rpc_client
        .get_program_accounts_with_config(&dlmm_interface::ID, config)
        .await?;

    let mut keys_to_fetch = HashSet::new();

    for (key, account) in position_key_with_accounts {
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&account.data[..8]);
        println!("Position {key} deserialize");

        match disc {
            POSITION_ACCOUNT_DISCM => {
                let position_state = PositionAccount::deserialize(&account.data)?.0;

                let lower_bin_array_idx =
                    BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
                let upper_bin_array_idx = lower_bin_array_idx + 1;

                keys_to_fetch.insert(derive_bin_array_pda(pool_key, lower_bin_array_idx.into()).0);
                keys_to_fetch.insert(derive_bin_array_pda(pool_key, upper_bin_array_idx.into()).0);
            }
            POSITION_V2_ACCOUNT_DISCM => {
                let position_state = PositionV2Account::deserialize(&account.data)?.0;

                let lower_bin_array_idx =
                    BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
                let upper_bin_array_idx = lower_bin_array_idx + 1;

                keys_to_fetch.insert(derive_bin_array_pda(pool_key, lower_bin_array_idx.into()).0);
                keys_to_fetch.insert(derive_bin_array_pda(pool_key, upper_bin_array_idx.into()).0);
            }
            POSITION_V3_ACCOUNT_DISCM => {
                let position_state = DynamicPosition::deserialize(&account.data)?;
                let bin_array_required =
                    position_state.global_data.get_bin_array_keys_coverage()?;
                keys_to_fetch.extend(bin_array_required);
            }
            _ => {
                bail!("Unknown position account type");
            }
        }

        keys_to_fetch.insert(key);
    }

    Ok(Vec::from_iter(keys_to_fetch.into_iter()))
}

async fn get_pool_associated_account_keys(
    rpc_client: &RpcClient,
    pool_key: Pubkey,
) -> Result<Vec<Pubkey>> {
    let pool_account = rpc_client.get_account(&pool_key).await?;
    let pool_state = LbPairAccount::deserialize(pool_account.data.as_ref())?.0;

    let mut keys_to_fetch = vec![
        pool_key,
        pool_state.token_x_mint,
        pool_state.token_y_mint,
        pool_state.reserve_x,
        pool_state.reserve_y,
    ];

    for reward in pool_state.reward_infos.iter() {
        if reward.mint != Pubkey::default() {
            keys_to_fetch.push(reward.mint);
            keys_to_fetch.push(reward.vault);
        }
    }

    Ok(keys_to_fetch)
}

fn override_position_owner(
    accounts_with_key: &mut [(solana_sdk::account::Account, Pubkey)],
    wallet_key: Pubkey,
) -> Result<()> {
    for (account, key) in accounts_with_key {
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&account.data[..8]);

        match disc {
            POSITION_ACCOUNT_DISCM => {
                let position_state = bytemuck::from_bytes_mut::<Position>(&mut account.data[8..]);
                println!(
                    "Override position owner {} to {}",
                    position_state.owner, wallet_key
                );
                position_state.owner = wallet_key;
            }
            POSITION_V2_ACCOUNT_DISCM => {
                let position_state = bytemuck::from_bytes_mut::<PositionV2>(&mut account.data[8..]);
                println!(
                    "Override position owner {} to {}",
                    position_state.owner, wallet_key
                );
                position_state.owner = wallet_key;
            }
            POSITION_V3_ACCOUNT_DISCM => {
                let position_state =
                    bytemuck::from_bytes_mut::<PositionV3>(&mut account.data[8..GLOBAL_DATA_SPACE]);
                println!(
                    "Override position owner {} to {}",
                    position_state.owner, wallet_key
                );
                position_state.owner = wallet_key;
            }
            _ => {
                continue;
            }
        }
    }

    Ok(())
}

pub async fn execute_download_user_pool_files(
    params: DownloadUserPoolFilesParams,
    rpc_client: RpcClient,
) -> Result<()> {
    let DownloadUserPoolFilesParams {
        output_path,
        wallet_key,
        pool_key,
        override_wallet_key,
    } = params;

    let position_associated_keys =
        get_bin_array_and_position_keys(&rpc_client, wallet_key, pool_key).await?;

    let pool_associated_keys = get_pool_associated_account_keys(&rpc_client, pool_key).await?;

    let keys_to_fetch = [position_associated_keys, pool_associated_keys].concat();

    let mut accounts_with_key = rpc_client
        .get_multiple_accounts(&keys_to_fetch)
        .await?
        .into_iter()
        .zip(keys_to_fetch)
        .filter_map(|(account, key)| Some((account?, key)))
        .collect::<Vec<_>>();

    if let Some(wallet_key) = override_wallet_key {
        override_position_owner(&mut accounts_with_key, wallet_key)?;
    }

    let rpc_keyed_accounts = accounts_with_key
        .into_iter()
        .map(|(account, key)| RpcKeyedAccount::new(&key, &account))
        .collect::<Vec<_>>();

    for account_to_write in rpc_keyed_accounts {
        let file_path = format!("{output_path}/{}.json", account_to_write.pubkey);
        tokio::fs::write(
            file_path,
            serde_json::to_string(&account_to_write)?.as_bytes(),
        )
        .await?;
    }

    Ok(())
}
