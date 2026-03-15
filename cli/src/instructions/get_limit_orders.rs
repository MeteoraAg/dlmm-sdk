use std::collections::{HashMap, HashSet};

use crate::*;
use commons::dlmm::accounts::{BinArray, LimitOrder};
use commons::extensions::limit_order::{LimitOrderExtension, ParsedLimitOrder};
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};

#[derive(Debug, Parser)]
pub struct GetLimitOrdersParams {
    /// Address of the lb pair
    #[clap(long)]
    pub lb_pair: Pubkey,
    /// Owner of the limit orders (defaults to payer if not specified)
    #[clap(long)]
    pub owner: Option<Pubkey>,
}

pub async fn execute_get_limit_orders<C: Deref<Target = impl Signer> + Clone>(
    params: GetLimitOrdersParams,
    program: &Program<C>,
) -> Result<()> {
    let GetLimitOrdersParams { lb_pair, owner } = params;
    let owner = owner.unwrap_or_else(|| program.payer());

    let rpc_client = program.rpc();

    // 1. Fetch limit order account infos
    let account_config = RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        ..Default::default()
    };
    let config = RpcProgramAccountsConfig {
        filters: Some(limit_order_filter_by_owner_and_pair(owner, lb_pair)),
        account_config,
        ..Default::default()
    };

    let lo_accounts = rpc_client
        .get_program_accounts_with_config(&dlmm::ID, config)
        .await?;

    if lo_accounts.is_empty() {
        println!(
            "No limit orders found for owner {} on pair {}",
            owner, lb_pair
        );
        return Ok(());
    }

    // 2. Decode bin IDs and derive bin array coverage
    let mut all_bin_array_indexes = HashSet::new();
    for (_pubkey, account) in &lo_accounts {
        let bin_ids = LimitOrder::get_bin_ids(&account.data)?;
        let indexes = LimitOrder::get_bin_array_indexes_coverage(&bin_ids)?;
        for idx in indexes {
            all_bin_array_indexes.insert(idx);
        }
    }

    // 3. Fetch lb_pair state and all required bin arrays
    let all_bin_array_indexes: Vec<i32> = {
        let mut v: Vec<i32> = all_bin_array_indexes.into_iter().collect();
        v.sort();
        v
    };
    let all_bin_array_pubkeys: Vec<Pubkey> = all_bin_array_indexes
        .iter()
        .map(|&idx| derive_bin_array_pda(lb_pair, idx.into()).0)
        .collect();
    let accounts_to_fetch: Vec<Pubkey> = [vec![lb_pair], all_bin_array_pubkeys].concat();

    // Batch fetch in chunks of 100 (Solana RPC limit)
    let mut fetched_accounts = Vec::with_capacity(accounts_to_fetch.len());
    for chunk in accounts_to_fetch.chunks(100) {
        let results = rpc_client.get_multiple_accounts(chunk).await?;
        fetched_accounts.extend(results);
    }

    let lb_pair_account = fetched_accounts[0]
        .as_ref()
        .context("Failed to fetch lb pair account")?;
    let lb_pair_state: LbPair = pod_read_unaligned_skip_disc(&lb_pair_account.data)?;

    let collect_fee_mode = lb_pair_state.parameters.collect_fee_mode;

    let mut bin_array_map: HashMap<i32, BinArray> = HashMap::new();
    for (i, &idx) in all_bin_array_indexes.iter().enumerate() {
        if let Some(account) = &fetched_accounts[1 + i] {
            let bin_array: BinArray = pod_read_unaligned_skip_disc(&account.data)?;
            bin_array_map.insert(idx, bin_array);
        }
    }

    // 4. Parse and display each limit order using ParsedLimitOrder
    println!(
        "Found {} limit order(s) for owner {} on pair {}",
        lo_accounts.len(),
        owner,
        lb_pair
    );
    println!();

    for (lo_key, account) in &lo_accounts {
        let parsed = ParsedLimitOrder::parse(&account.data, &bin_array_map, collect_fee_mode)?;

        println!("Limit Order: {}", lo_key);

        for r in &parsed.result.bins {
            let side = if r.is_ask { "Ask" } else { "Bid" };
            println!(
                "  Bin {} [{}] status={} empty={} deposit={} filled={} unfilled={} swapped={} feeX={} feeY={}",
                r.bin_id,
                side,
                r.status,
                r.is_empty,
                r.deposit_amount,
                r.fulfilled_amount,
                r.unfilled_amount,
                r.swapped_amount,
                r.fee_x,
                r.fee_y,
            );
        }

        let summary = &parsed.result.summary;
        println!("  ---");
        println!(
            "  Total deposit:   X={} Y={}",
            summary.total_deposit_x, summary.total_deposit_y
        );
        println!(
            "  Total filled:    X={} Y={}",
            summary.total_filled_x, summary.total_filled_y
        );
        println!(
            "  Total unfilled:  X={} Y={}",
            summary.total_unfilled_x, summary.total_unfilled_y
        );
        println!(
            "  Total swapped:   X={} Y={}",
            summary.total_swapped_x, summary.total_swapped_y
        );
        println!(
            "  Total fee:       X={} Y={}",
            summary.total_fee_x, summary.total_fee_y
        );

        println!(
            "  Withdrawable:    X={} Y={}",
            summary.withdrawable_x(),
            summary.withdrawable_y()
        );
        println!();
    }

    Ok(())
}
