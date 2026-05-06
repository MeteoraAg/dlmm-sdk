use std::collections::{HashMap, HashSet};

use crate::*;
use dlmm::accounts::LimitOrder;
use dlmm::types::LimitOrderBinData;
use solana_sdk::pubkey::Pubkey;

use super::bin_array::BinArrayExtension;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LimitOrderStatus {
    NotFilled,
    PartialFilled,
    Fulfilled,
}

impl std::fmt::Display for LimitOrderStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LimitOrderStatus::NotFilled => write!(f, "NotFilled"),
            LimitOrderStatus::PartialFilled => write!(f, "PartialFilled"),
            LimitOrderStatus::Fulfilled => write!(f, "Fulfilled"),
        }
    }
}

/// Per-bin result from processing a limit order bin against on-chain state.
#[derive(Debug, Clone, Copy)]
pub struct LimitOrderBinResult {
    pub bin_id: i32,
    pub is_ask: bool,
    pub is_empty: bool,
    pub status: LimitOrderStatus,
    pub deposit_amount: u64,
    pub fulfilled_amount: u64,
    pub unfilled_amount: u64,
    pub swapped_amount: u64,
    pub fee_x: u64,
    pub fee_y: u64,
}

#[derive(Debug, Clone, Default)]
pub struct LimitOrderSummary {
    pub total_deposit_x: u64,
    pub total_deposit_y: u64,
    pub total_filled_x: u64,
    pub total_filled_y: u64,
    pub total_unfilled_x: u64,
    pub total_unfilled_y: u64,
    pub total_swapped_x: u64,
    pub total_swapped_y: u64,
    pub total_fee_x: u64,
    pub total_fee_y: u64,
}

impl LimitOrderSummary {
    pub fn withdrawable_x(&self) -> u64 {
        self.total_unfilled_x
            .saturating_add(self.total_swapped_x)
            .saturating_add(self.total_fee_x)
    }

    pub fn withdrawable_y(&self) -> u64 {
        self.total_unfilled_y
            .saturating_add(self.total_swapped_y)
            .saturating_add(self.total_fee_y)
    }
}

#[derive(Debug, Clone)]
pub struct LimitOrderResult {
    pub bins: Vec<LimitOrderBinResult>,
    pub summary: LimitOrderSummary,
}

#[derive(Debug, Clone)]
pub struct ParsedLimitOrder {
    pub limit_order: LimitOrder,
    pub result: LimitOrderResult,
}

impl ParsedLimitOrder {
    pub fn parse(
        data: &[u8],
        bin_array_map: &HashMap<i32, BinArray>,
        collect_fee_mode: u8,
    ) -> Result<Self> {
        let lo_size = std::mem::size_of::<LimitOrder>();
        let limit_order: LimitOrder = bytemuck::pod_read_unaligned(&data[8..8 + lo_size]);
        let bin_count: usize = limit_order.bin_count.into();

        let bin_data_start = 8 + lo_size;
        let bin_data_size = std::mem::size_of::<LimitOrderBinData>();
        let mut bin_data_list = Vec::with_capacity(bin_count);
        for i in 0..bin_count {
            let offset = bin_data_start + i * bin_data_size;
            if offset + bin_data_size > data.len() {
                break;
            }
            let bin_data: LimitOrderBinData =
                bytemuck::pod_read_unaligned(&data[offset..offset + bin_data_size]);
            bin_data_list.push(bin_data);
        }

        let mut bin_pairs = Vec::with_capacity(bin_data_list.len());
        for bin_data in &bin_data_list {
            let bin_array_idx = BinArray::bin_id_to_bin_array_index(bin_data.bin_id)?;
            let bin_array = bin_array_map
                .get(&bin_array_idx)
                .context("Missing bin array")?;
            let bin = *bin_array.get_bin(bin_data.bin_id)?;
            bin_pairs.push((*bin_data, bin));
        }

        let result = Self::process(&bin_pairs, collect_fee_mode)?;

        Ok(Self {
            limit_order,
            result,
        })
    }

    fn get_status(lo_age: u32, bin: &Bin) -> Result<LimitOrderStatus> {
        if lo_age == bin.order_age {
            Ok(LimitOrderStatus::NotFilled)
        } else if lo_age + 1 == bin.order_age {
            if bin.open_order_amount == 0 && bin.processed_order_remaining_amount == 0 {
                Ok(LimitOrderStatus::Fulfilled)
            } else {
                Ok(LimitOrderStatus::PartialFilled)
            }
        } else if lo_age + 2 <= bin.order_age {
            Ok(LimitOrderStatus::Fulfilled)
        } else {
            Err(anyhow::anyhow!("Failed to determine limit order status"))
        }
    }

    fn get_amount_in(amount_out: u64, price: u128, swap_for_y: bool) -> Result<u64> {
        if swap_for_y {
            safe_shl_div_cast(amount_out.into(), price, SCALE_OFFSET, Rounding::Down)
        } else {
            safe_mul_shr_cast(amount_out.into(), price, SCALE_OFFSET, Rounding::Down)
        }
    }

    fn calculate_fee(
        fulfilled_amount: u64,
        is_ask_side: bool,
        collect_fee_mode: u8,
        bin: &Bin,
    ) -> Result<(u64, u64)> {
        if fulfilled_amount == 0 {
            return Ok((0, 0));
        }

        if is_ask_side && bin.fulfilled_order_amount_x == 0 {
            return Ok((0, 0));
        }
        if !is_ask_side && bin.fulfilled_order_amount_y == 0 {
            return Ok((0, 0));
        }

        let fee: u64 = if is_ask_side {
            u128::from(bin.limit_order_fee_ask_side)
                .checked_mul(u128::from(fulfilled_amount))
                .context("MathOverflow")?
                .checked_div(u128::from(bin.fulfilled_order_amount_x))
                .context("MathOverflow")?
                .try_into()
                .context("MathOverflow")?
        } else {
            u128::from(bin.limit_order_fee_bid_side)
                .checked_mul(u128::from(fulfilled_amount))
                .context("MathOverflow")?
                .checked_div(u128::from(bin.fulfilled_order_amount_y))
                .context("MathOverflow")?
                .try_into()
                .context("MathOverflow")?
        };

        match collect_fee_mode {
            0 => {
                // InputOnly
                if is_ask_side {
                    Ok((0, fee)) // fee in Y
                } else {
                    Ok((fee, 0)) // fee in X
                }
            }
            1 => {
                // OnlyY
                Ok((0, fee))
            }
            _ => Ok((0, 0)),
        }
    }

    fn calculate_fill_amounts(
        bin_data: &LimitOrderBinData,
        bin: &Bin,
        status: LimitOrderStatus,
    ) -> Result<(u64, u64)> {
        match status {
            LimitOrderStatus::NotFilled => Ok((0u64, bin_data.amount)),
            LimitOrderStatus::PartialFilled => {
                if bin.total_processing_order_amount == 0 {
                    Ok((bin_data.amount, 0u64))
                } else {
                    let unfilled: u64 = u128::from(bin_data.amount)
                        .checked_mul(u128::from(bin.processed_order_remaining_amount))
                        .context("MathOverflow")?
                        .div_ceil(u128::from(bin.total_processing_order_amount))
                        .try_into()
                        .context("MathOverflow")?;
                    let filled = bin_data
                        .amount
                        .checked_sub(unfilled)
                        .context("MathOverflow")?;
                    Ok((filled, unfilled))
                }
            }
            LimitOrderStatus::Fulfilled => Ok((bin_data.amount, 0u64)),
        }
    }

    fn process_bin(
        bin_data: &LimitOrderBinData,
        bin: &Bin,
        collect_fee_mode: u8,
    ) -> Result<LimitOrderBinResult> {
        let is_ask = bin_data.is_ask != 0;
        let status = Self::get_status(bin_data.age, bin)?;
        let (fulfilled_amount, unfilled_amount) =
            Self::calculate_fill_amounts(bin_data, bin, status)?;

        let swapped_amount = if fulfilled_amount > 0 && bin.price > 0 {
            Self::get_amount_in(fulfilled_amount, bin.price, !is_ask)?
        } else {
            0
        };

        let (fee_x, fee_y) = Self::calculate_fee(fulfilled_amount, is_ask, collect_fee_mode, bin)?;

        let is_empty = bin_data.age == 0 && bin_data.amount == 0;

        Ok(LimitOrderBinResult {
            bin_id: bin_data.bin_id,
            is_ask,
            is_empty,
            status,
            deposit_amount: bin_data.amount,
            fulfilled_amount,
            unfilled_amount,
            swapped_amount,
            fee_x,
            fee_y,
        })
    }

    fn process(
        bins: &[(LimitOrderBinData, Bin)],
        collect_fee_mode: u8,
    ) -> Result<LimitOrderResult> {
        let mut results = Vec::with_capacity(bins.len());
        let mut summary = LimitOrderSummary::default();

        for (bin_data, bin) in bins {
            let r = Self::process_bin(bin_data, bin, collect_fee_mode)?;

            if r.is_ask {
                summary.total_deposit_x = summary
                    .total_deposit_x
                    .checked_add(r.deposit_amount)
                    .context("MathOverflow")?;
                summary.total_filled_x = summary
                    .total_filled_x
                    .checked_add(r.fulfilled_amount)
                    .context("MathOverflow")?;
                summary.total_unfilled_x = summary
                    .total_unfilled_x
                    .checked_add(r.unfilled_amount)
                    .context("MathOverflow")?;
                summary.total_swapped_y = summary
                    .total_swapped_y
                    .checked_add(r.swapped_amount)
                    .context("MathOverflow")?;
            } else {
                summary.total_deposit_y = summary
                    .total_deposit_y
                    .checked_add(r.deposit_amount)
                    .context("MathOverflow")?;
                summary.total_filled_y = summary
                    .total_filled_y
                    .checked_add(r.fulfilled_amount)
                    .context("MathOverflow")?;
                summary.total_unfilled_y = summary
                    .total_unfilled_y
                    .checked_add(r.unfilled_amount)
                    .context("MathOverflow")?;
                summary.total_swapped_x = summary
                    .total_swapped_x
                    .checked_add(r.swapped_amount)
                    .context("MathOverflow")?;
            }
            summary.total_fee_x = summary
                .total_fee_x
                .checked_add(r.fee_x)
                .context("MathOverflow")?;
            summary.total_fee_y = summary
                .total_fee_y
                .checked_add(r.fee_y)
                .context("MathOverflow")?;

            results.push(r);
        }

        Ok(LimitOrderResult {
            bins: results,
            summary,
        })
    }
}

pub trait LimitOrderExtension {
    /// Extract bin IDs from raw limit order account data without full deserialization.
    fn get_bin_ids(data: &[u8]) -> Result<Vec<i32>>;

    /// Return the unique bin array indexes required to cover the given bin IDs.
    fn get_bin_array_indexes_coverage(bin_ids: &[i32]) -> Result<Vec<i32>>;

    /// Return the unique bin array pubkeys required to cover the given bin IDs.
    fn get_bin_array_pubkeys_coverage(bin_ids: &[i32], lb_pair: Pubkey) -> Result<Vec<Pubkey>>;
}

impl LimitOrderExtension for LimitOrder {
    fn get_bin_ids(data: &[u8]) -> Result<Vec<i32>> {
        let lo_size = std::mem::size_of::<LimitOrder>();
        let limit_order: LimitOrder = bytemuck::pod_read_unaligned(&data[8..8 + lo_size]);
        let bin_count: usize = limit_order.bin_count.into();

        let bin_data_start = 8 + lo_size;
        let bin_data_size = std::mem::size_of::<LimitOrderBinData>();
        let bin_id_offset = 16; // bin_id field offset within LimitOrderBinData (repr C)
        let mut bin_ids = Vec::with_capacity(bin_count);

        for i in 0..bin_count {
            let offset = bin_data_start + i * bin_data_size + bin_id_offset;
            if offset + 4 > data.len() {
                break;
            }
            let bin_id = i32::from_le_bytes(data[offset..offset + 4].try_into()?);
            bin_ids.push(bin_id);
        }

        Ok(bin_ids)
    }

    fn get_bin_array_indexes_coverage(bin_ids: &[i32]) -> Result<Vec<i32>> {
        let mut indexes = HashSet::new();
        for &bin_id in bin_ids {
            let idx = BinArray::bin_id_to_bin_array_index(bin_id)?;
            indexes.insert(idx);
        }
        let mut sorted: Vec<i32> = indexes.into_iter().collect();
        sorted.sort();
        Ok(sorted)
    }

    fn get_bin_array_pubkeys_coverage(bin_ids: &[i32], lb_pair: Pubkey) -> Result<Vec<Pubkey>> {
        let indexes = Self::get_bin_array_indexes_coverage(bin_ids)?;
        Ok(indexes
            .into_iter()
            .map(|idx| derive_bin_array_pda(lb_pair, idx.into()).0)
            .collect())
    }
}
