use std::collections::{BTreeSet, HashMap};

use crate::*;
use commons::extensions::dynamic_position::DynamicPosition;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};

#[derive(Debug, Parser)]
pub struct GetAllPositionsParams {
    /// Address of the pair
    #[clap(long)]
    lb_pair: Pubkey,
    /// Owner of position
    #[clap(long)]
    owner: Pubkey,
}

pub async fn execute_get_all_positions<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    params: GetAllPositionsParams,
) -> Result<()> {
    let GetAllPositionsParams { lb_pair, owner } = params;

    let rpc_client = program.rpc();

    let account_config = RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        ..Default::default()
    };
    let config = RpcProgramAccountsConfig {
        filters: Some(position_filter_by_wallet_and_pair(owner, lb_pair)),
        account_config,
        ..Default::default()
    };

    let position_accounts = rpc_client
        .get_program_accounts_with_config(&dlmm::ID, config)
        .await?;

    if position_accounts.is_empty() {
        println!("No positions found for owner {} on pair {}", owner, lb_pair);
        return Ok(());
    }

    // Decode all positions and collect required bin array indexes
    let mut positions: Vec<(Pubkey, PositionV2)> = Vec::with_capacity(position_accounts.len());
    let mut all_bin_array_indexes: BTreeSet<i32> = BTreeSet::new();

    for (key, account) in &position_accounts {
        let position_state: PositionV2 = pod_read_unaligned_skip_disc(&account.data)?;

        let lower_idx = BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
        let upper_idx = BinArray::bin_id_to_bin_array_index(position_state.upper_bin_id)?;
        for idx in lower_idx..=upper_idx {
            all_bin_array_indexes.insert(idx);
        }
        positions.push((*key, position_state));
    }

    // Fetch lb_pair, clock, and all bin arrays
    let bin_array_pubkeys: Vec<Pubkey> = all_bin_array_indexes
        .iter()
        .map(|&idx| derive_bin_array_pda(lb_pair, idx.into()).0)
        .collect();

    let accounts_to_fetch: Vec<Pubkey> = [
        vec![lb_pair, solana_sdk::sysvar::clock::ID],
        bin_array_pubkeys,
    ]
    .concat();

    let mut fetched = Vec::with_capacity(accounts_to_fetch.len());
    for chunk in accounts_to_fetch.chunks(100) {
        let results = rpc_client.get_multiple_accounts(chunk).await?;
        fetched.extend(results);
    }

    let lb_pair_account = fetched[0]
        .as_ref()
        .context("Failed to fetch lb pair account")?;
    let lb_pair_state: LbPair = pod_read_unaligned_skip_disc(&lb_pair_account.data)?;

    let clock_account = fetched[1]
        .as_ref()
        .context("Failed to fetch clock account")?;
    let clock: solana_sdk::sysvar::clock::Clock =
        bincode::deserialize(clock_account.data.as_ref())?;

    let mut bin_array_map: HashMap<i32, BinArray> = HashMap::new();
    for (i, &idx) in all_bin_array_indexes.iter().enumerate() {
        if let Some(account) = &fetched[2 + i] {
            let bin_array: BinArray = pod_read_unaligned_skip_disc(&account.data)?;
            bin_array_map.insert(idx, bin_array);
        }
    }

    println!(
        "Found {} position(s) for owner {} on pair {}\n",
        positions.len(),
        owner,
        lb_pair
    );

    for ((position_key, position_state), (_, raw_account)) in
        positions.iter().zip(position_accounts.iter())
    {
        println!("Position: {}", position_key);
        let dynamic_position = DynamicPosition::parse(
            position_state,
            &raw_account.data,
            &lb_pair_state,
            &bin_array_map,
            clock.unix_timestamp,
        )?;
        println!("{}", dynamic_position);
    }

    Ok(())
}
