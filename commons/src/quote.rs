use crate::*;
use anchor_client::solana_sdk::pubkey::Pubkey;
use core::result::Result::Ok;
use solana_sdk::{account::Account, clock::Clock};
use std::collections::HashMap;

#[derive(Debug)]
pub struct SwapExactInQuote {
    pub amount_out: u64,
    pub fee: u64,
    pub protocol_fee: u64,
}

#[derive(Debug)]
pub struct SwapExactOutQuote {
    pub amount_in: u64,
    pub fee: u64,
    pub protocol_fee: u64,
}

/// Internal fill result for a single liquidity layer within a bin.
struct FillResult {
    amount_in: u64,
    amount_left: u64,
    out_amount: u64,
}

/// Internal result for filling across all liquidity layers (MM + limit orders) in a bin.
struct ExactInFillResult {
    amount_in: u64,
    amount_left: u64,
    out_amount: u64,
    mm_amount_in: u64,
}

/// Calculate how much of `amount` can be filled against `max_amount_out` of liquidity at `price`.
fn calculate_exact_in_fill_amount(
    bin: &Bin,
    amount: u64,
    max_amount_out: u64,
    swap_for_y: bool,
) -> Result<FillResult> {
    if max_amount_out == 0 {
        return Ok(FillResult {
            amount_in: 0,
            amount_left: amount,
            out_amount: 0,
        });
    }
    let max_amount_in = Bin::get_amount_in(max_amount_out, bin.price, swap_for_y, Rounding::Up)?;
    if amount >= max_amount_in {
        Ok(FillResult {
            amount_in: max_amount_in,
            amount_left: amount.checked_sub(max_amount_in).context("MathOverflow")?,
            out_amount: max_amount_out,
        })
    } else {
        let out_amount = Bin::get_amount_out(amount, bin.price, swap_for_y, Rounding::Down)?;
        Ok(FillResult {
            amount_in: amount,
            amount_left: 0,
            out_amount,
        })
    }
}

/// Fill a bin's liquidity layers: MM first, then processed limit orders, then open limit orders.
fn get_exact_in_fill_amount_result(
    bin: &Bin,
    amount_in: u64,
    swap_for_y: bool,
    support_limit_order: bool,
) -> Result<ExactInFillResult> {
    let mm_amount = if swap_for_y {
        bin.amount_y
    } else {
        bin.amount_x
    };
    let mm_fill = calculate_exact_in_fill_amount(bin, amount_in, mm_amount, swap_for_y)?;

    if !support_limit_order {
        return Ok(ExactInFillResult {
            amount_in: mm_fill.amount_in,
            amount_left: mm_fill.amount_left,
            out_amount: mm_fill.out_amount,
            mm_amount_in: mm_fill.amount_in,
        });
    }

    let mut total_amount_in = mm_fill.amount_in;
    let mut total_amount_out = mm_fill.out_amount;
    let amount_left_after_mm = mm_fill.amount_left;

    if amount_left_after_mm > 0 {
        let (open_order_amount, processed_order_remaining) =
            bin.get_limit_order_amounts_by_direction(swap_for_y);

        // Fill processed orders first
        let processed_fill = calculate_exact_in_fill_amount(
            bin,
            amount_left_after_mm,
            processed_order_remaining,
            swap_for_y,
        )?;
        total_amount_in = total_amount_in
            .checked_add(processed_fill.amount_in)
            .context("MathOverflow")?;
        total_amount_out = total_amount_out
            .checked_add(processed_fill.out_amount)
            .context("MathOverflow")?;

        // Fill open orders next
        if processed_fill.amount_left > 0 {
            let open_fill = calculate_exact_in_fill_amount(
                bin,
                processed_fill.amount_left,
                open_order_amount,
                swap_for_y,
            )?;
            total_amount_in = total_amount_in
                .checked_add(open_fill.amount_in)
                .context("MathOverflow")?;
            total_amount_out = total_amount_out
                .checked_add(open_fill.out_amount)
                .context("MathOverflow")?;
        }
    }

    Ok(ExactInFillResult {
        amount_in: total_amount_in,
        amount_left: amount_in
            .checked_sub(total_amount_in)
            .context("MathOverflow")?,
        out_amount: total_amount_out,
        mm_amount_in: mm_fill.amount_in,
    })
}

/// Split trading fee between user (LP) fee and protocol fee, accounting for limit order fee share.
fn split_fee(
    trading_fee: u64,
    protocol_share: u16,
    mm_amount_in: u64,
    total_amount_in: u64,
) -> Result<(u64, u64)> {
    if total_amount_in == 0 || trading_fee == 0 {
        return Ok((0, 0));
    }

    // mm_fee = ceil(trading_fee * mm_amount_in / total_amount_in)
    let mm_fee: u64 = u128::from(trading_fee)
        .checked_mul(mm_amount_in.into())
        .context("MathOverflow")?
        .checked_add(
            u128::from(total_amount_in)
                .checked_sub(1)
                .context("MathOverflow")?,
        )
        .context("MathOverflow")?
        .checked_div(total_amount_in.into())
        .context("MathOverflow")?
        .try_into()
        .context("MathOverflow")?;

    let total_lo_fee = trading_fee.checked_sub(mm_fee).context("MathOverflow")?;

    // LO fee: portion that goes to order placer
    let lo_fee: u64 = u128::from(total_lo_fee)
        .checked_mul(LIMIT_ORDER_FEE_SHARE.into())
        .context("MathOverflow")?
        .checked_div(BASIS_POINT_MAX as u128)
        .context("MathOverflow")?
        .try_into()
        .context("MathOverflow")?;

    let lo_protocol_fee = total_lo_fee.checked_sub(lo_fee).context("MathOverflow")?;

    // MM protocol fee
    let mm_protocol_fee: u64 = u128::from(mm_fee)
        .checked_mul(protocol_share.into())
        .context("MathOverflow")?
        .checked_div(BASIS_POINT_MAX as u128)
        .context("MathOverflow")?
        .try_into()
        .context("MathOverflow")?;

    let total_protocol_fee = lo_protocol_fee
        .checked_add(mm_protocol_fee)
        .context("MathOverflow")?;
    let total_user_fee = trading_fee
        .checked_sub(total_protocol_fee)
        .context("MathOverflow")?;

    Ok((total_user_fee, total_protocol_fee))
}

/// Per-bin exact-in quote with limit order and fee mode support.
fn swap_exact_in_quote_at_bin(
    bin: &Bin,
    lb_pair: &LbPair,
    in_amount: u64,
    swap_for_y: bool,
    support_limit_order: bool,
    fee_on_input: bool,
) -> Result<BinQuoteResult> {
    let mut trading_fee: u64 = 0;
    let mut excluded_fee_amount_in = in_amount;

    if fee_on_input {
        let fee = lb_pair.compute_fee_from_amount(in_amount)?;
        trading_fee = fee;
        excluded_fee_amount_in = in_amount.checked_sub(fee).context("MathOverflow")?;
    }

    let fill_result = get_exact_in_fill_amount_result(
        bin,
        excluded_fee_amount_in,
        swap_for_y,
        support_limit_order,
    )?;

    let amount_left = fill_result.amount_left;
    let out_amount = fill_result.out_amount;
    let mut included_fee_amount_in = in_amount;

    if amount_left > 0 {
        excluded_fee_amount_in = excluded_fee_amount_in
            .checked_sub(amount_left)
            .context("MathOverflow")?;

        if fee_on_input {
            let fee = lb_pair.compute_fee(excluded_fee_amount_in)?;
            trading_fee = fee;
            included_fee_amount_in = excluded_fee_amount_in
                .checked_add(fee)
                .context("MathOverflow")?;
        } else {
            included_fee_amount_in = excluded_fee_amount_in;
        }
    }

    let mut excluded_fee_amount_out = out_amount;

    if !fee_on_input {
        let fee = lb_pair.compute_fee_from_amount(out_amount)?;
        trading_fee = fee;
        excluded_fee_amount_out = out_amount.checked_sub(fee).context("MathOverflow")?;
    }

    let (_user_fee, protocol_fee) = split_fee(
        trading_fee,
        lb_pair.parameters.protocol_share,
        fill_result.mm_amount_in,
        fill_result.amount_in,
    )?;

    Ok(BinQuoteResult {
        amount_in: included_fee_amount_in,
        amount_out: excluded_fee_amount_out,
        fee: trading_fee,
        protocol_fee,
    })
}

fn get_excluded_fee_amount_in(
    bin: &Bin,
    swap_for_y: bool,
    included_fee_amount_out: u64,
) -> Result<u64> {
    let mm_amount = if swap_for_y {
        bin.amount_y
    } else {
        bin.amount_x
    };

    let (open_order_amount, processed_order_remaining_amount) =
        bin.get_limit_order_amounts_by_direction(swap_for_y);

    let mut remaining_amount_out = included_fee_amount_out;
    let mut total_amount_in: u64 = 0;

    let exact_out_amount = remaining_amount_out.min(mm_amount);
    let amount_in = Bin::get_amount_in(exact_out_amount, bin.price, swap_for_y, Rounding::Up)?;
    remaining_amount_out = remaining_amount_out
        .checked_sub(exact_out_amount)
        .context("MathOverflow")?;
    total_amount_in = total_amount_in
        .checked_add(amount_in)
        .context("MathOverflow")?;

    if remaining_amount_out > 0 {
        let exact_out_amount = remaining_amount_out.min(processed_order_remaining_amount);
        let amount_in = Bin::get_amount_in(exact_out_amount, bin.price, swap_for_y, Rounding::Up)?;
        remaining_amount_out = remaining_amount_out
            .checked_sub(exact_out_amount)
            .context("MathOverflow")?;
        total_amount_in = total_amount_in
            .checked_add(amount_in)
            .context("MathOverflow")?;

        if remaining_amount_out > 0 {
            let exact_out_amount = remaining_amount_out.min(open_order_amount);
            let amount_in =
                Bin::get_amount_in(exact_out_amount, bin.price, swap_for_y, Rounding::Up)?;
            total_amount_in = total_amount_in
                .checked_add(amount_in)
                .context("MathOverflow")?;
        }
    }

    Ok(total_amount_in)
}

/// Per-bin exact-out quote with limit order and fee mode support.
fn swap_exact_out_quote_at_bin(
    bin: &Bin,
    lb_pair: &LbPair,
    out_amount: u64,
    swap_for_y: bool,
    support_limit_order: bool,
    fee_on_input: bool,
) -> Result<BinQuoteResult> {
    let mut included_fee_amount_out = out_amount;

    if !fee_on_input {
        let fee = lb_pair.compute_fee(out_amount)?;
        included_fee_amount_out = out_amount.checked_add(fee).context("MathOverflow")?;
    }

    let max_amount_out = bin.get_max_amount_out_with_limit_orders(swap_for_y, support_limit_order);

    if included_fee_amount_out >= max_amount_out {
        // Drain entire bin
        return swap_exact_in_quote_at_bin(
            bin,
            lb_pair,
            u64::MAX,
            swap_for_y,
            support_limit_order,
            fee_on_input,
        );
    }

    // Calculate required input for exact output
    let excluded_fee_amount_in =
        get_excluded_fee_amount_in(bin, swap_for_y, included_fee_amount_out)?;

    let included_fee_amount_in = if fee_on_input {
        let fee = lb_pair.compute_fee(excluded_fee_amount_in)?;
        excluded_fee_amount_in
            .checked_add(fee)
            .context("MathOverflow")?
    } else {
        excluded_fee_amount_in
    };

    let mut result = swap_exact_in_quote_at_bin(
        bin,
        lb_pair,
        included_fee_amount_in,
        swap_for_y,
        support_limit_order,
        fee_on_input,
    )?;

    // Delta between quoted output and requested output goes to protocol (rounding)
    if result.amount_out > out_amount {
        let delta = result
            .amount_out
            .checked_sub(out_amount)
            .context("MathOverflow")?;
        if delta > 1 {
            result.protocol_fee = result
                .protocol_fee
                .checked_add(delta)
                .context("MathOverflow")?;
        }
    }

    result.amount_out = out_amount;

    Ok(result)
}

fn validate_swap_activation(
    lb_pair: &LbPair,
    current_timestamp: u64,
    current_slot: u64,
) -> Result<()> {
    ensure!(
        lb_pair.status()?.eq(&PairStatus::Enabled),
        "Pair is disabled"
    );

    let pair_type = lb_pair.pair_type()?;
    if pair_type.eq(&PairType::Permission) || pair_type.eq(&PairType::CustomizablePermissionless) {
        let activation_type = lb_pair.activation_type()?;
        let current_point = match activation_type {
            ActivationType::Slot => current_slot,
            ActivationType::Timestamp => current_timestamp,
        };

        ensure!(
            current_point >= lb_pair.activation_point,
            "Pair is disabled"
        );
    }

    Ok(())
}

fn shift_active_bin_if_empty_gap(
    lb_pair: &mut LbPair,
    active_bin_array: &BinArray,
    swap_for_y: bool,
) -> Result<()> {
    let lb_pair_bin_array_index = BinArray::bin_id_to_bin_array_index(lb_pair.active_id)?;

    if i64::from(lb_pair_bin_array_index) != active_bin_array.index {
        if swap_for_y {
            let (_, upper_bin_id) =
                BinArray::get_bin_array_lower_upper_bin_id(active_bin_array.index as i32)?;
            lb_pair.active_id = upper_bin_id;
        } else {
            let (lower_bin_id, _) =
                BinArray::get_bin_array_lower_upper_bin_id(active_bin_array.index as i32)?;
            lb_pair.active_id = lower_bin_id;
        }
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn quote_exact_out(
    lb_pair_pubkey: Pubkey,
    lb_pair: &LbPair,
    mut amount_out: u64,
    swap_for_y: bool,
    bin_arrays: HashMap<Pubkey, BinArray>,
    bitmap_extension: Option<&BinArrayBitmapExtension>,
    clock: &Clock,
    mint_x_account: &Account,
    mint_y_account: &Account,
) -> Result<SwapExactOutQuote> {
    let current_timestamp = clock.unix_timestamp as u64;
    let current_slot = clock.slot;
    let epoch = clock.epoch;

    validate_swap_activation(lb_pair, current_timestamp, current_slot)?;

    let mut lb_pair = *lb_pair;
    lb_pair.update_references(current_timestamp as i64)?;

    let support_limit_order = lb_pair.is_support_limit_order();
    let fee_on_input = lb_pair.fee_on_input(swap_for_y);

    let mut total_amount_in: u64 = 0;
    let mut total_fee: u64 = 0;
    let mut total_protocol_fee: u64 = 0;

    let (in_mint_account, out_mint_account) = if swap_for_y {
        (mint_x_account, mint_y_account)
    } else {
        (mint_y_account, mint_x_account)
    };

    amount_out =
        calculate_transfer_fee_included_amount(out_mint_account, amount_out, epoch)?.amount;

    while amount_out > 0 {
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

        shift_active_bin_if_empty_gap(&mut lb_pair, &active_bin_array, swap_for_y)?;

        loop {
            if !active_bin_array.is_bin_id_within_range(lb_pair.active_id)? || amount_out == 0 {
                break;
            }

            let active_bin = active_bin_array.get_bin_mut(lb_pair.active_id)?;
            let _price = active_bin.get_or_store_bin_price(lb_pair.active_id, lb_pair.bin_step)?;

            let max_out =
                active_bin.get_max_amount_out_with_limit_orders(swap_for_y, support_limit_order);

            if max_out > 0 {
                lb_pair.update_volatility_accumulator()?;

                let result = swap_exact_out_quote_at_bin(
                    active_bin,
                    &lb_pair,
                    amount_out,
                    swap_for_y,
                    support_limit_order,
                    fee_on_input,
                )?;

                if result.amount_out > 0 {
                    amount_out = amount_out
                        .checked_sub(result.amount_out)
                        .context("MathOverflow")?;
                    total_amount_in = total_amount_in
                        .checked_add(result.amount_in)
                        .context("MathOverflow")?;
                    total_fee = total_fee.checked_add(result.fee).context("MathOverflow")?;
                    total_protocol_fee = total_protocol_fee
                        .checked_add(result.protocol_fee)
                        .context("MathOverflow")?;
                }
            }

            if amount_out > 0 {
                lb_pair.advance_active_bin(swap_for_y)?;
            }
        }
    }

    total_amount_in =
        calculate_transfer_fee_included_amount(in_mint_account, total_amount_in, epoch)?.amount;

    Ok(SwapExactOutQuote {
        amount_in: total_amount_in,
        fee: total_fee,
        protocol_fee: total_protocol_fee,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn quote_exact_in(
    lb_pair_pubkey: Pubkey,
    lb_pair: &LbPair,
    amount_in: u64,
    swap_for_y: bool,
    bin_arrays: HashMap<Pubkey, BinArray>,
    bitmap_extension: Option<&BinArrayBitmapExtension>,
    clock: &Clock,
    mint_x_account: &Account,
    mint_y_account: &Account,
) -> Result<SwapExactInQuote> {
    let current_timestamp = clock.unix_timestamp as u64;
    let current_slot = clock.slot;
    let epoch = clock.epoch;

    validate_swap_activation(lb_pair, current_timestamp, current_slot)?;

    let mut lb_pair = *lb_pair;
    lb_pair.update_references(current_timestamp as i64)?;

    let support_limit_order = lb_pair.is_support_limit_order();
    let fee_on_input = lb_pair.fee_on_input(swap_for_y);

    let mut total_amount_out: u64 = 0;
    let mut total_fee: u64 = 0;
    let mut total_protocol_fee: u64 = 0;

    let (in_mint_account, out_mint_account) = if swap_for_y {
        (mint_x_account, mint_y_account)
    } else {
        (mint_y_account, mint_x_account)
    };

    let transfer_fee_excluded_amount_in =
        calculate_transfer_fee_excluded_amount(in_mint_account, amount_in, epoch)?.amount;

    let mut amount_left = transfer_fee_excluded_amount_in;

    while amount_left > 0 {
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

        shift_active_bin_if_empty_gap(&mut lb_pair, &active_bin_array, swap_for_y)?;

        loop {
            if !active_bin_array.is_bin_id_within_range(lb_pair.active_id)? || amount_left == 0 {
                break;
            }

            let active_bin = active_bin_array.get_bin_mut(lb_pair.active_id)?;

            let max_out =
                active_bin.get_max_amount_out_with_limit_orders(swap_for_y, support_limit_order);

            if max_out > 0 {
                lb_pair.update_volatility_accumulator()?;

                let result = swap_exact_in_quote_at_bin(
                    active_bin,
                    &lb_pair,
                    amount_left,
                    swap_for_y,
                    support_limit_order,
                    fee_on_input,
                )?;

                if result.amount_in > 0 {
                    amount_left = amount_left
                        .checked_sub(result.amount_in)
                        .context("MathOverflow")?;
                    total_amount_out = total_amount_out
                        .checked_add(result.amount_out)
                        .context("MathOverflow")?;
                    total_fee = total_fee.checked_add(result.fee).context("MathOverflow")?;
                    total_protocol_fee = total_protocol_fee
                        .checked_add(result.protocol_fee)
                        .context("MathOverflow")?;
                }
            }

            if amount_left > 0 {
                lb_pair.advance_active_bin(swap_for_y)?;
            }
        }
    }

    let transfer_fee_excluded_amount_out =
        calculate_transfer_fee_excluded_amount(out_mint_account, total_amount_out, epoch)?.amount;

    Ok(SwapExactInQuote {
        amount_out: transfer_fee_excluded_amount_out,
        fee: total_fee,
        protocol_fee: total_protocol_fee,
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
    use anchor_client::solana_client::rpc_response::RpcKeyedAccount;
    use anchor_client::solana_sdk::clock::Clock;
    use anchor_client::{
        solana_client::nonblocking::rpc_client::RpcClient, solana_sdk::pubkey::Pubkey, Cluster,
    };
    use litesvm::LiteSVM;

    pub const DLMM_PROGRAM_FILE_PATH: &str = "../artifacts/lb_clmm.so";

    /// Get on chain clock
    async fn get_clock(rpc_client: RpcClient) -> Result<Clock> {
        let clock_account = rpc_client
            .get_account(&anchor_client::solana_sdk::sysvar::clock::ID)
            .await?;

        let clock_state: Clock = bincode::deserialize(clock_account.data.as_ref())?;

        Ok(clock_state)
    }

    #[tokio::test]
    async fn test_swap_quote_exact_out() {
        // RPC client. No gPA is required.
        let rpc_client = RpcClient::new(Cluster::Mainnet.url().to_string());

        let sol_usdc = Pubkey::from_str_const("HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR");

        let lb_pair_account = rpc_client.get_account(&sol_usdc).await.unwrap();

        let lb_pair: LbPair = bytemuck::pod_read_unaligned(&lb_pair_account.data[8..]);

        let mut mint_accounts = rpc_client
            .get_multiple_accounts(&[lb_pair.token_x_mint, lb_pair.token_y_mint])
            .await
            .unwrap();

        let mint_x_account = mint_accounts[0].take().unwrap();
        let mint_y_account = mint_accounts[1].take().unwrap();

        // 3 bin arrays to left, and right is enough to cover most of the swap, and stay under 1.4m CU constraint.
        // Get 3 bin arrays to the left from the active bin
        let left_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(sol_usdc, &lb_pair, None, true, 3).unwrap();

        // Get 3 bin arrays to the right the from active bin
        let right_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(sol_usdc, &lb_pair, None, false, 3).unwrap();

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
                    bytemuck::pod_read_unaligned(&account.unwrap().data[8..]),
                )
            })
            .collect::<HashMap<_, _>>();

        let usdc_token_multiplier = 1_000_000.0;
        let sol_token_multiplier = 1_000_000_000.0;

        let out_sol_amount = 1_000_000_000;
        let clock = get_clock(rpc_client).await.unwrap();

        let quote_result = quote_exact_out(
            sol_usdc,
            &lb_pair,
            out_sol_amount,
            false,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        )
        .unwrap();

        let in_amount = quote_result.amount_in + quote_result.fee;

        println!(
            "{} USDC -> exact 1 SOL",
            in_amount as f64 / usdc_token_multiplier
        );

        let quote_result = quote_exact_in(
            sol_usdc,
            &lb_pair,
            in_amount,
            false,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        )
        .unwrap();

        println!(
            "{} USDC -> {} SOL",
            in_amount as f64 / usdc_token_multiplier,
            quote_result.amount_out as f64 / sol_token_multiplier
        );

        let out_usdc_amount = 200_000_000;

        let quote_result = quote_exact_out(
            sol_usdc,
            &lb_pair,
            out_usdc_amount,
            true,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        )
        .unwrap();

        let in_amount = quote_result.amount_in + quote_result.fee;

        println!(
            "{} SOL -> exact 200 USDC",
            in_amount as f64 / sol_token_multiplier
        );

        let quote_result = quote_exact_in(
            sol_usdc,
            &lb_pair,
            in_amount,
            true,
            bin_arrays,
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        )
        .unwrap();

        println!(
            "{} SOL -> {} USDC",
            in_amount as f64 / sol_token_multiplier,
            quote_result.amount_out as f64 / usdc_token_multiplier
        );
    }

    #[tokio::test]
    async fn test_swap_quote_exact_in() {
        // RPC client. No gPA is required.
        let rpc_client = RpcClient::new(Cluster::Mainnet.url().to_string());

        let sol_usdc = Pubkey::from_str_const("HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR");

        let lb_pair_account = rpc_client.get_account(&sol_usdc).await.unwrap();

        let lb_pair: LbPair = bytemuck::pod_read_unaligned(&lb_pair_account.data[8..]);

        let mut mint_accounts = rpc_client
            .get_multiple_accounts(&[lb_pair.token_x_mint, lb_pair.token_y_mint])
            .await
            .unwrap();

        let mint_x_account = mint_accounts[0].take().unwrap();
        let mint_y_account = mint_accounts[1].take().unwrap();

        // 3 bin arrays to left, and right is enough to cover most of the swap, and stay under 1.4m CU constraint.
        // Get 3 bin arrays to the left from the active bin
        let left_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(sol_usdc, &lb_pair, None, true, 3).unwrap();

        // Get 3 bin arrays to the right the from active bin
        let right_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(sol_usdc, &lb_pair, None, false, 3).unwrap();

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
                    bytemuck::pod_read_unaligned(&account.unwrap().data[8..]),
                )
            })
            .collect::<HashMap<_, _>>();

        // 1 SOL -> USDC
        let in_sol_amount = 5_000_000_000;

        let clock = get_clock(rpc_client).await.unwrap();

        let quote_result = quote_exact_in(
            sol_usdc,
            &lb_pair,
            in_sol_amount,
            true,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        )
        .unwrap();

        println!(
            "1 SOL -> {:?} USDC",
            quote_result.amount_out as f64 / 1_000_000.0
        );

        // 100 USDC -> SOL
        let in_usdc_amount = 100_000_000;

        let quote_result = quote_exact_in(
            sol_usdc,
            &lb_pair,
            in_usdc_amount,
            false,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        )
        .unwrap();

        println!(
            "100 USDC -> {:?} SOL",
            quote_result.amount_out as f64 / 1_000_000_000.0
        );
    }

    #[test]
    fn test_swap_quote_infinite_loop() {
        let test_pair = Pubkey::from_str_const("FJbEo74c2W4QLBBVUfUvi8VBWXtMdJVPuFpq2f6UV1iB");
        let associated_accounts_folder_path = format!("../artifacts/{}", test_pair);

        let mut svm = LiteSVM::new().with_sysvars();
        let program_bytes = std::fs::read(DLMM_PROGRAM_FILE_PATH).unwrap();
        svm.add_program(dlmm::ID, &program_bytes);

        let accounts_dir = std::fs::read_dir(associated_accounts_folder_path).unwrap();
        for entry in accounts_dir {
            let account_data = std::fs::read_to_string(entry.unwrap().path()).unwrap();
            let rpc_account: RpcKeyedAccount =
                serde_json::from_str(&account_data).expect("Failed to deserialize account data");
            let account: anchor_client::solana_sdk::account::Account =
                rpc_account.account.decode().unwrap();
            let account_pubkey = Pubkey::from_str_const(&rpc_account.pubkey);

            svm.set_account(account_pubkey, account.clone()).unwrap();
        }

        let lb_pair_account = svm.get_account(&test_pair).unwrap();
        let lb_pair: LbPair = bytemuck::pod_read_unaligned(&lb_pair_account.data[8..]);

        let left_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(test_pair, &lb_pair, None, true, 3).unwrap();

        let right_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(test_pair, &lb_pair, None, false, 3).unwrap();

        let bin_array_pubkeys = [left_bin_array_pubkeys, right_bin_array_pubkeys].concat();

        let mut bin_arrays = HashMap::new();

        for bin_array_pubkey in bin_array_pubkeys {
            let bin_array_account = svm.get_account(&bin_array_pubkey).unwrap();
            let bin_array: BinArray = bytemuck::pod_read_unaligned(&bin_array_account.data[8..]);
            bin_arrays.insert(bin_array_pubkey, bin_array);
        }

        let in_base_amount = 5_000_000_000;
        let clock: Clock = svm.get_sysvar();

        let mint_x_account = svm.get_account(&lb_pair.token_x_mint).unwrap();
        let mint_y_account = svm.get_account(&lb_pair.token_y_mint).unwrap();

        // 1. Quote in ask
        let quote_result = quote_exact_in(
            test_pair,
            &lb_pair,
            in_base_amount,
            true,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        );

        assert!(quote_result.is_err());
        let err = quote_result.unwrap_err();
        assert_eq!(err.to_string(), "Pool out of liquidity");

        // 2. Quote in bid
        let in_quote_amount = 5_000_000_000;
        let quote_result = quote_exact_in(
            test_pair,
            &lb_pair,
            in_quote_amount,
            false,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        );
        assert!(quote_result.is_err());
        let err = quote_result.unwrap_err();
        assert_eq!(err.to_string(), "Pool out of liquidity");

        // 3. Quote out ask
        let out_quote_amount = 5_000_000_000;
        let quote_result = quote_exact_out(
            test_pair,
            &lb_pair,
            out_quote_amount,
            true,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        );

        assert!(quote_result.is_err());
        let err = quote_result.unwrap_err();
        assert_eq!(err.to_string(), "Pool out of liquidity");

        // 4. Quote out bid
        let out_base_amount = 5_000_000_000;
        let quote_result = quote_exact_out(
            test_pair,
            &lb_pair,
            out_base_amount,
            false,
            bin_arrays.clone(),
            None,
            &clock,
            &mint_x_account,
            &mint_y_account,
        );

        assert!(quote_result.is_err());
        let err = quote_result.unwrap_err();
        assert_eq!(err.to_string(), "Pool out of liquidity");
    }
}
