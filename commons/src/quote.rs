use anchor_client::solana_sdk::pubkey::Pubkey;
use anyhow::{Context, Result};
use lb_clmm::{
    state::{
        bin::{BinArray, SwapResult},
        bin_array_bitmap_extension::BinArrayBitmapExtension,
        lb_pair::LbPair,
    },
    utils::pda::derive_bin_array_pda,
};
use std::collections::HashMap;

#[derive(Debug)]
pub struct SwapQuote {
    pub amount_out: u64,
    pub fee: u64,
}

pub fn quote_exact_in(
    lb_pair_pubkey: Pubkey,
    lb_pair: &LbPair,
    mut amount_in: u64,
    swap_for_y: bool,
    bin_arrays: HashMap<Pubkey, BinArray>,
    bitmap_extension: Option<&BinArrayBitmapExtension>,
    current_timestamp: u64,
) -> Result<SwapQuote> {
    let mut lb_pair = *lb_pair;
    lb_pair.update_references(current_timestamp as i64)?;

    let mut total_amount_out: u64 = 0;
    let mut total_fee: u64 = 0;

    while amount_in > 0 {
        let active_bin_array_pubkey = get_bin_array_pubkeys_for_swap(
            lb_pair_pubkey,
            &lb_pair,
            bitmap_extension,
            swap_for_y,
            1,
        )?
        .pop()
        .context("Pool out of liquidity")?;

        let mut active_bin_array = bin_arrays
            .get(&active_bin_array_pubkey)
            .cloned()
            .context("Active bin array not found")?;

        loop {
            if active_bin_array
                .is_bin_id_within_range(lb_pair.active_id)
                .is_err()
                || amount_in == 0
            {
                break;
            }

            lb_pair.update_volatility_accumulator()?;

            let active_bin = active_bin_array.get_bin_mut(lb_pair.active_id)?;
            let price = active_bin.get_or_store_bin_price(lb_pair.active_id, lb_pair.bin_step)?;

            if !active_bin.is_empty(!swap_for_y) {
                let SwapResult {
                    amount_in_with_fees,
                    amount_out,
                    fee,
                    ..
                } = active_bin.swap(amount_in, price, swap_for_y, &lb_pair, None)?;

                amount_in = amount_in
                    .checked_sub(amount_in_with_fees)
                    .context("MathOverflow")?;

                total_amount_out = total_amount_out
                    .checked_add(amount_out)
                    .context("MathOverflow")?;
                total_fee = total_fee.checked_add(fee).context("MathOverflow")?;
            }

            if amount_in > 0 {
                lb_pair.advance_active_bin(swap_for_y)?;
            }
        }
    }

    Ok(SwapQuote {
        amount_out: total_amount_out,
        fee: total_fee,
    })
}

pub fn get_bin_array_pubkeys_for_swap(
    lb_pair_pubkey: Pubkey,
    lb_pair: &LbPair,
    bitmap_extension: Option<&BinArrayBitmapExtension>,
    swap_for_y: bool,
    take_count: u8,
) -> Result<Vec<Pubkey>> {
    let mut start_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair.active_id)?;
    let mut bin_array_idx = vec![];
    let increment = if swap_for_y { -1 } else { 1 };

    loop {
        if bin_array_idx.len() == take_count as usize {
            break;
        }

        if lb_pair.is_overflow_default_bin_array_bitmap(start_bin_array_idx) {
            let Some(bitmap_extension) = bitmap_extension else {
                break;
            };
            let Ok((next_bin_array_idx, has_liquidity)) = bitmap_extension
                .next_bin_array_index_with_liquidity(swap_for_y, start_bin_array_idx)
            else {
                // Out of search range. No liquidity.
                break;
            };
            if has_liquidity {
                bin_array_idx.push(next_bin_array_idx);
                start_bin_array_idx = next_bin_array_idx + increment;
            } else {
                // Switch to internal bitmap
                start_bin_array_idx = next_bin_array_idx;
            }
        } else {
            let Ok((next_bin_array_idx, has_liquidity)) = lb_pair
                .next_bin_array_index_with_liquidity_internal(swap_for_y, start_bin_array_idx)
            else {
                break;
            };
            if has_liquidity {
                bin_array_idx.push(next_bin_array_idx);
                start_bin_array_idx = next_bin_array_idx + increment;
            } else {
                // Switch to external bitmap
                start_bin_array_idx = next_bin_array_idx;
            }
        }
    }

    let bin_array_pubkeys = bin_array_idx
        .into_iter()
        .map(|idx| derive_bin_array_pda(lb_pair_pubkey, idx.into()).0)
        .collect();

    Ok(bin_array_pubkeys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_client::anchor_lang::AccountDeserialize;
    use anchor_client::solana_sdk::clock::Clock;
    use anchor_client::{
        solana_client::nonblocking::rpc_client::RpcClient,
        solana_sdk::{pubkey::Pubkey, signature::Keypair},
        Client, Cluster,
    };
    use std::time::SystemTime;
    use std::{rc::Rc, str::FromStr};

    /// Get on chain clock, or use current node slot
    async fn get_current_timestamp(rpc_client: Option<RpcClient>) -> u64 {
        match rpc_client {
            Some(rpc_client) => {
                let clock_account = rpc_client
                    .get_account(&anchor_client::solana_sdk::sysvar::clock::ID)
                    .await
                    .unwrap();

                let clock_state: Clock = bincode::deserialize(clock_account.data.as_ref()).unwrap();
                clock_state.unix_timestamp as u64
            }
            None => SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    #[tokio::test]
    async fn test_swap_quote_exact_in() {
        // RPC client. No gPA is required.
        let rpc_client = RpcClient::new(Cluster::Mainnet.url().to_string());

        let client = Client::new(
            Cluster::Custom(rpc_client.url(), rpc_client.url()),
            Rc::new(Keypair::new()),
        );

        let program = client.program(lb_clmm::ID).unwrap();

        let SOL_USDC = Pubkey::from_str("HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR").unwrap();

        let lb_pair = program.account::<LbPair>(SOL_USDC).await.unwrap();

        // 3 bin arrays to left, and right is enough to cover most of the swap, and stay under 1.4m CU constraint.
        // Get 3 bin arrays to the left from the active bin
        let left_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(SOL_USDC, &lb_pair, None, true, 3).unwrap();

        // Get 3 bin arrays to the right the from active bin
        let right_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(SOL_USDC, &lb_pair, None, false, 3).unwrap();

        // Fetch bin arrays
        let bin_array_pubkeys = left_bin_array_pubkeys
            .into_iter()
            .chain(right_bin_array_pubkeys.into_iter())
            .collect::<Vec<Pubkey>>();

        let accounts = rpc_client
            .get_multiple_accounts(&bin_array_pubkeys)
            .await
            .unwrap();

        let bin_arrays = accounts
            .into_iter()
            .zip(bin_array_pubkeys.into_iter())
            .map(|(account, key)| {
                (
                    key,
                    BinArray::try_deserialize(&mut account.unwrap().data.as_ref()).unwrap(),
                )
            })
            .collect::<HashMap<_, _>>();

        // 1 SOL -> USDC
        let in_sol_amount = 1_000_000_000;

        let current_timestamp = get_current_timestamp(Some(rpc_client)).await;

        let quote_result = quote_exact_in(
            SOL_USDC,
            &lb_pair,
            in_sol_amount,
            true,
            bin_arrays.clone(),
            None,
            current_timestamp,
        )
        .unwrap();

        println!(
            "1 SOL -> {:?} USDC",
            quote_result.amount_out as f64 / 1_000_000.0
        );

        // 100 USDC -> SOL
        let in_usdc_amount = 100_000_000;

        let quote_result = quote_exact_in(
            SOL_USDC,
            &lb_pair,
            in_usdc_amount,
            false,
            bin_arrays.clone(),
            None,
            current_timestamp,
        )
        .unwrap();

        println!(
            "100 USDC -> {:?} SOL",
            quote_result.amount_out as f64 / 1_000_000_000.0
        );
    }
}
