use std::cell::RefMut;

use super::lb_pair::LbPair;
use crate::{
    constants::{BASIS_POINT_MAX, MAX_BIN_ID, MAX_BIN_PER_ARRAY, MIN_BIN_ID, NUM_REWARDS},
    errors::*,
    math::{
        price_math::get_price_from_id,
        safe_math::SafeMath,
        u128x128_math::Rounding,
        u64x64_math::SCALE_OFFSET,
        utils_math::{safe_mul_div_cast, safe_mul_shr_cast, safe_shl_div_cast},
    },
};
use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use num_integer::Integer;
use static_assertions::const_assert_eq;
/// Calculate out token amount based on liquidity share and supply
#[inline]
pub fn get_out_amount(
    liquidity_share: u128,
    bin_token_amount: u64,
    liquidity_supply: u128,
) -> Result<u64> {
    if liquidity_supply == 0 {
        return Ok(0);
    }

    // liquidity_share * bin_token_amount / liquidity_supply
    safe_mul_div_cast(
        liquidity_share.into(),
        bin_token_amount.into(),
        liquidity_supply.into(),
        Rounding::Down,
    )
}

/// Calculate liquidity share upon deposit
#[inline]
pub fn get_liquidity_share(
    in_liquidity: u128,
    bin_liquidity: u128,
    liquidity_supply: u128,
) -> Result<u128> {
    safe_mul_div_cast(
        in_liquidity.into(),
        liquidity_supply.into(),
        bin_liquidity.into(),
        Rounding::Down,
    )
}

#[derive(Debug)]
pub struct SwapResult {
    /// Amount of token swap into the bin
    pub amount_in_with_fees: u64,
    /// Amount of token swap out from the bin
    pub amount_out: u64,
    /// Swap fee, includes protocol fee
    pub fee: u64,
    /// Part of fee
    pub protocol_fee_after_host_fee: u64,
    /// Part of protocol fee
    pub host_fee: u64,
    /// whether the swap has reached cap, only used in swap_with_cap_function
    pub is_reach_cap: bool,
}

#[zero_copy]
#[derive(Default, Debug, InitSpace)]
pub struct Bin {
    /// Amount of token X in the bin. This already excluded protocol fees.
    pub amount_x: u64,
    /// Amount of token Y in the bin. This already excluded protocol fees.
    pub amount_y: u64,
    /// Bin price
    pub price: u128,
    /// Liquidities of the bin. This is the same as LP mint supply. q-number
    pub liquidity_supply: u128,
    /// reward_a_per_token_stored
    pub reward_per_token_stored: [u128; NUM_REWARDS],
    /// Swap fee amount of token X per liquidity deposited.
    pub fee_amount_x_per_token_stored: u128,
    /// Swap fee amount of token Y per liquidity deposited.
    pub fee_amount_y_per_token_stored: u128,
    /// Total token X swap into the bin. Only used for tracking purpose.
    pub amount_x_in: u128,
    /// Total token Y swap into he bin. Only used for tracking purpose.
    pub amount_y_in: u128,
}

impl Bin {
    pub fn is_zero_liquidity(&self) -> bool {
        self.liquidity_supply == 0
    }
    /// Deposit to the bin.
    pub fn deposit(&mut self, amount_x: u64, amount_y: u64, liquidity_share: u128) -> Result<()> {
        self.amount_x = self.amount_x.safe_add(amount_x)?;
        self.amount_y = self.amount_y.safe_add(amount_y)?;
        self.liquidity_supply = self.liquidity_supply.safe_add(liquidity_share)?;

        Ok(())
    }

    /// Deposit composition fee
    pub fn deposit_composition_fee(&mut self, fee_x: u64, fee_y: u64) -> Result<()> {
        self.amount_x = self.amount_x.safe_add(fee_x)?;
        self.amount_y = self.amount_y.safe_add(fee_y)?;

        Ok(())
    }

    /// Get or compute and save bin price if not exists
    pub fn get_or_store_bin_price(&mut self, id: i32, bin_step: u16) -> Result<u128> {
        if self.price == 0 {
            self.price = get_price_from_id(id, bin_step)?;
        }

        Ok(self.price)
    }

    /// Update fee per liquidity stored. Used for claiming swap fee later.
    pub fn update_fee_per_token_stored(&mut self, fee: u64, swap_for_y: bool) -> Result<()> {
        let fee_per_token_stored: u128 = safe_shl_div_cast(
            fee.into(),
            self.liquidity_supply
                .safe_shr(SCALE_OFFSET.into())?
                .try_into()
                .map_err(|_| LBError::TypeCastFailed)?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        // Fee was charged at swap-in side
        if swap_for_y {
            // Change to wrapping add later
            self.fee_amount_x_per_token_stored = self
                .fee_amount_x_per_token_stored
                .safe_add(fee_per_token_stored)?;
        } else {
            self.fee_amount_y_per_token_stored = self
                .fee_amount_y_per_token_stored
                .safe_add(fee_per_token_stored)?;
        }
        Ok(())
    }

    pub fn swap_with_cap(
        &mut self,
        amount_in: u64,
        price: u128,
        swap_for_y: bool,
        lb_pair: &LbPair,
        host_fee_bps: Option<u16>,
        remaining_cap: u64,
    ) -> Result<SwapResult> {
        // Get maximum out token amount can be swapped out from the bin.
        let max_amount_out = self.get_max_amount_out(swap_for_y);
        if max_amount_out < remaining_cap {
            return self.swap(amount_in, price, swap_for_y, lb_pair, host_fee_bps);
        }

        let amount_in = amount_in.min(Bin::get_amount_in(remaining_cap, price, swap_for_y)?);
        let mut swap_result = self.swap(amount_in, price, swap_for_y, lb_pair, host_fee_bps)?;
        swap_result.is_reach_cap = true;
        Ok(swap_result)
    }
    /// Swap
    pub fn swap(
        &mut self,
        amount_in: u64,
        price: u128,
        swap_for_y: bool,
        lb_pair: &LbPair,
        host_fee_bps: Option<u16>,
    ) -> Result<SwapResult> {
        // Get maximum out token amount can be swapped out from the bin.
        let max_amount_out = self.get_max_amount_out(swap_for_y);
        // Get maximum in token amount needed to swap out all of the opposite token from the bin.
        let mut max_amount_in = self.get_max_amount_in(price, swap_for_y)?;

        // The fee was deducted from the amount_in if the swap will not move the active bin. So, the amount_in include fees
        // When the amount_in > max_amount_in, it will swap finish all the current bin token X/Y based on the swap direction.
        // However, max_amount_in is amount that required to swap finish the current bin without fee
        // Therefore, we need find max_amount_in_include_fees, where max_amount_in_include_fees - fee = max_amount_in
        let max_fee = lb_pair.compute_fee(max_amount_in)?;
        max_amount_in = max_amount_in.safe_add(max_fee)?;

        // If the in token amount > maximum token amount needed to swap out all of the opposite token from the bin.
        let (amount_in_with_fees, amount_out, fee, protocol_fee) = if amount_in > max_amount_in {
            (
                max_amount_in,
                max_amount_out,
                max_fee,
                lb_pair.compute_protocol_fee(max_fee)?,
            )
        } else {
            // TODO: User possible to bypass fee by swapping small amount ? User do a "normal" swap by just bundling all small swap that bypass fee ?
            let fee = lb_pair.compute_fee_from_amount(amount_in)?;
            let amount_in_after_fee = amount_in.safe_sub(fee)?;
            let amount_out = self.get_amount_out(amount_in_after_fee, price, swap_for_y)?;
            (
                amount_in,
                std::cmp::min(amount_out, max_amount_out),
                fee,
                lb_pair.compute_protocol_fee(fee)?,
            )
        };

        let host_fee = match host_fee_bps {
            Some(bps) => protocol_fee
                .safe_mul(bps.into())?
                .safe_div(BASIS_POINT_MAX as u64)?,
            None => 0,
        };

        let protocol_fee_after_host_fee = protocol_fee.safe_sub(host_fee)?;

        // Exclude fee and protocol fee. Protocol fee already part of fee. User need to claim the fee later.
        let amount_into_bin = amount_in_with_fees.safe_sub(fee)?;

        if swap_for_y {
            self.amount_x = self.amount_x.safe_add(amount_into_bin)?;
            self.amount_y = self.amount_y.safe_sub(amount_out)?;
        } else {
            self.amount_y = self.amount_y.safe_add(amount_into_bin)?;
            self.amount_x = self.amount_x.safe_sub(amount_out)?;
        }

        Ok(SwapResult {
            amount_in_with_fees,
            amount_out,
            fee,
            protocol_fee_after_host_fee,
            host_fee,
            is_reach_cap: false,
        })
    }

    /// Withdraw token X, and Y from the bin based on liquidity share.
    pub fn withdraw(&mut self, liquidity_share: u128) -> Result<(u64, u64)> {
        let (out_amount_x, out_amount_y) = self.calculate_out_amount(liquidity_share)?;

        self.amount_x = self.amount_x.safe_sub(out_amount_x)?;
        self.amount_y = self.amount_y.safe_sub(out_amount_y)?;

        self.liquidity_supply = self.liquidity_supply.safe_sub(liquidity_share)?;

        Ok((out_amount_x, out_amount_y))
    }

    /// Calcualte out amount based on liquidity share
    pub fn calculate_out_amount(&self, liquidity_share: u128) -> Result<(u64, u64)> {
        // Math::round_down(liquidity_share_to_withdraw * amount_x / bin_liquidity_supply)
        let out_amount_x = safe_mul_div_cast(
            liquidity_share,
            self.amount_x.into(),
            self.liquidity_supply,
            Rounding::Down,
        )?;

        // Math::round_down(liquidity_share_to_withdraw * amount_y / bin_liquidity_supply)
        let out_amount_y = safe_mul_div_cast(
            liquidity_share,
            self.amount_y.into(),
            self.liquidity_supply,
            Rounding::Down,
        )?;
        Ok((out_amount_x, out_amount_y))
    }

    pub fn is_empty(&self, is_x: bool) -> bool {
        if is_x {
            self.amount_x == 0
        } else {
            self.amount_y == 0
        }
    }

    /// Get maximum token amount able to be swapped out from the bin.
    #[inline]
    pub fn get_max_amount_out(&self, swap_for_y: bool) -> u64 {
        if swap_for_y {
            self.amount_y
        } else {
            self.amount_x
        }
    }

    /// Get out token amount from the bin based in amount in. The result is floor-ed.
    /// X -> Y: inX * bin_price
    /// Y -> X: inY / bin_price
    pub fn get_amount_out(&self, amount_in: u64, price: u128, swap_for_y: bool) -> Result<u64> {
        if swap_for_y {
            // (Q64x64(price) * Q64x0(amount_in)) >> SCALE_OFFSET
            // price * amount_in = amount_out_token_y (Q64x64)
            // amount_out_in_token_y >> SCALE_OFFSET (convert it back to integer form, with some loss of precision [Rounding::Down])
            safe_mul_shr_cast(price, amount_in.into(), SCALE_OFFSET, Rounding::Down)
        } else {
            // (amount_in << SCALE_OFFSET) / price
            // Convert amount_in into Q64x0, if not the result will always in 0 as price is in Q64x64
            // Division between same Q number format cancel out, result in integer
            // amount_in / price = amount_out_token_x (integer [Rounding::Down])
            safe_shl_div_cast(amount_in.into(), price, SCALE_OFFSET, Rounding::Down)
        }
    }

    /// This function reserves amount_in from amount_out, used when user swap with cap limit
    pub fn get_amount_in(amount_out: u64, price: u128, swap_for_y: bool) -> Result<u64> {
        if swap_for_y {
            // (amount_y << SCALE_OFFSET) / price
            // Convert amount_y into Q64x0, if not the result will always in 0 as price is in Q64x64
            // Division between same Q number format cancel out, result in integer
            // amount_y / price = amount_in_token_x (integer [Rounding::Down])
            safe_shl_div_cast(amount_out.into(), price, SCALE_OFFSET, Rounding::Down)
        } else {
            // (Q64x64(price) * Q64x0(amount_x)) >> SCALE_OFFSET
            // price * amount_x = amount_in_token_y (Q64x64)
            // amount_in_token_y >> SCALE_OFFSET (convert it back to integer form [Rounding::Down])
            safe_mul_shr_cast(amount_out.into(), price, SCALE_OFFSET, Rounding::Down)
        }
    }

    /// Get maximum token amount needed to deposit into bin, in order to withdraw out all the opposite token from the bin. The result is ceil-ed.
    /// X -> Y: reserve_y / bin_price
    /// Y -> X: reserve_x * bin_price
    pub fn get_max_amount_in(&self, price: u128, swap_for_y: bool) -> Result<u64> {
        if swap_for_y {
            // (amount_y << SCALE_OFFSET) / price
            // Convert amount_y into Q64x0, if not the result will always in 0 as price is in Q64x64
            // Division between same Q number format cancel out, result in integer
            // amount_y / price = amount_in_token_x (integer [Rounding::Up])
            safe_shl_div_cast(self.amount_y.into(), price, SCALE_OFFSET, Rounding::Up)
        } else {
            // (Q64x64(price) * Q64x0(amount_x)) >> SCALE_OFFSET
            // price * amount_x = amount_in_token_y (Q64x64)
            // amount_in_token_y >> SCALE_OFFSET (convert it back to integer form [Rounding::Up])
            safe_mul_shr_cast(self.amount_x.into(), price, SCALE_OFFSET, Rounding::Up)
        }
    }

    pub fn get_max_amounts_in(&self, price: u128) -> Result<(u64, u64)> {
        let max_amount_in_x = self.get_max_amount_in(price, true)?;
        let max_amount_in_y = self.get_max_amount_in(price, false)?;

        Ok((max_amount_in_x, max_amount_in_y))
    }

    /// Accumulate amount X and Y swap into the bin for analytic purpose.
    pub fn accumulate_amounts_in(&mut self, amount_x_in: u64, amount_y_in: u64) {
        self.amount_x_in = self.amount_x_in.wrapping_add(amount_x_in.into());
        self.amount_y_in = self.amount_y_in.wrapping_add(amount_y_in.into());
    }
}

#[derive(Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Layout version
pub enum LayoutVersion {
    V0,
    V1,
}

#[account(zero_copy)]
#[derive(Debug, InitSpace)]
/// An account to contain a range of bin. For example: Bin 100 <-> 200.
/// For example:
/// BinArray index: 0 contains bin 0 <-> 599
/// index: 2 contains bin 600 <-> 1199, ...
pub struct BinArray {
    pub index: i64, // Larger size to make bytemuck "safe" (correct alignment)
    /// Version of binArray
    pub version: u8,
    pub _padding: [u8; 7],
    pub lb_pair: Pubkey,
    pub bins: [Bin; MAX_BIN_PER_ARRAY],
}

const_assert_eq!(std::mem::size_of::<BinArray>(), 10128);

impl BinArray {
    pub fn is_zero_liquidity(&self) -> bool {
        for bin in self.bins.iter() {
            if !bin.is_zero_liquidity() {
                return false;
            }
        }
        true
    }

    pub fn initialize(&mut self, index: i64, lb_pair: Pubkey) -> Result<()> {
        require!(i32::try_from(index).is_ok(), LBError::InvalidStartBinIndex);
        BinArray::check_valid_index(index as i32)?;

        self.index = index;
        self.lb_pair = lb_pair;
        self.version = LayoutVersion::V1.into();
        self.bins = [Bin::default(); MAX_BIN_PER_ARRAY];

        Ok(())
    }

    pub fn migrate_to_v2(&mut self) -> Result<()> {
        let version: LayoutVersion = self
            .version
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?;
        if version == LayoutVersion::V0 {
            self.version = LayoutVersion::V1.into();
            for bin in self.bins.iter_mut() {
                bin.liquidity_supply = bin.liquidity_supply.safe_shl(SCALE_OFFSET.into())?;
            }
        }
        Ok(())
    }

    pub fn get_bin_index_in_array(&self, bin_id: i32) -> Result<usize> {
        self.is_bin_id_within_range(bin_id)?;
        self.get_bin_index_internal(bin_id)
    }

    fn get_bin_index_internal(&self, bin_id: i32) -> Result<usize> {
        let (lower_bin_id, upper_bin_id) =
            BinArray::get_bin_array_lower_upper_bin_id(self.index as i32)?;

        let index = if bin_id.is_positive() {
            // When bin id is positive, the index is ascending
            bin_id.safe_sub(lower_bin_id)?
        } else {
            // When bin id is negative, the index is descending. Eg: bin id -1 will be located at last index of the bin array
            ((MAX_BIN_PER_ARRAY as i32).safe_sub(upper_bin_id.safe_sub(bin_id)?)?).safe_sub(1)?
        };

        if index >= 0 && index < MAX_BIN_PER_ARRAY as i32 {
            Ok(index as usize)
        } else {
            Err(LBError::InvalidBinId.into())
        }
    }

    /// Get bin from bin array
    pub fn get_bin_mut<'a>(&'a mut self, bin_id: i32) -> Result<&mut Bin> {
        Ok(&mut self.bins[self.get_bin_index_in_array(bin_id)?])
    }

    pub fn get_bin<'a>(&'a self, bin_id: i32) -> Result<&'a Bin> {
        Ok(&self.bins[self.get_bin_index_in_array(bin_id)?])
    }

    /// Check whether the bin id is within the bin array range
    pub fn is_bin_id_within_range(&self, bin_id: i32) -> Result<()> {
        let (lower_bin_id, upper_bin_id) =
            BinArray::get_bin_array_lower_upper_bin_id(self.index as i32)?;

        require!(
            bin_id >= lower_bin_id && bin_id <= upper_bin_id,
            LBError::InvalidBinId
        );

        Ok(())
    }

    /// Get bin array index from bin id
    pub fn bin_id_to_bin_array_index(bin_id: i32) -> Result<i32> {
        let (idx, rem) = bin_id.div_rem(&(MAX_BIN_PER_ARRAY as i32));

        if bin_id.is_negative() && rem != 0 {
            Ok(idx.safe_sub(1)?)
        } else {
            Ok(idx)
        }
    }

    /// Get lower and upper bin id of the given bin array index
    pub fn get_bin_array_lower_upper_bin_id(index: i32) -> Result<(i32, i32)> {
        let lower_bin_id = index.safe_mul(MAX_BIN_PER_ARRAY as i32)?;
        let upper_bin_id = lower_bin_id
            .safe_add(MAX_BIN_PER_ARRAY as i32)?
            .safe_sub(1)?;

        Ok((lower_bin_id, upper_bin_id))
    }

    /// Check that the index within MAX and MIN bin id
    pub fn check_valid_index(index: i32) -> Result<()> {
        let (lower_bin_id, upper_bin_id) = BinArray::get_bin_array_lower_upper_bin_id(index)?;

        require!(
            lower_bin_id >= MIN_BIN_ID && upper_bin_id <= MAX_BIN_ID,
            LBError::InvalidStartBinIndex
        );

        Ok(())
    }

    /// Update the bin reward(s) per liquidity share stored for the active bin.
    pub fn update_all_rewards(
        &mut self,
        lb_pair: &mut RefMut<'_, LbPair>,
        current_time: u64,
    ) -> Result<()> {
        for reward_idx in 0..NUM_REWARDS {
            let bin = self.get_bin_mut(lb_pair.active_id)?;
            let reward_info = &mut lb_pair.reward_infos[reward_idx];

            if reward_info.initialized() {
                if bin.liquidity_supply > 0 {
                    let reward_per_token_stored_delta = reward_info
                        .calculate_reward_per_token_stored_since_last_update(
                            current_time,
                            bin.liquidity_supply
                                .safe_shr(SCALE_OFFSET.into())?
                                .try_into()
                                .map_err(|_| LBError::TypeCastFailed)?,
                        )?;

                    bin.reward_per_token_stored[reward_idx] = bin.reward_per_token_stored
                        [reward_idx]
                        .safe_add(reward_per_token_stored_delta)?;
                } else {
                    // Time period which the reward was distributed to empty bin
                    let time_period =
                        reward_info.get_seconds_elapsed_since_last_update(current_time)?;

                    // Save the time window of empty bin reward, and reward it in the next time window
                    reward_info.cumulative_seconds_with_empty_liquidity_reward = reward_info
                        .cumulative_seconds_with_empty_liquidity_reward
                        .safe_add(time_period)?;
                }

                reward_info.update_last_update_time(current_time);
            }
        }
        Ok(())
    }

    // Check whether those bins between from_bin_id to to_bin_id are zero in a binArray
    pub fn is_zero_liquidity_in_range(&self, from_bin_id: i32, to_bin_id: i32) -> Result<bool> {
        self.is_bin_id_within_range(from_bin_id)?;

        let (lower_bin_id, upper_bin_id) =
            BinArray::get_bin_array_lower_upper_bin_id(self.index as i32)?;

        let (start_bin_id, end_bin_id) = if from_bin_id > to_bin_id {
            let start_bin_id = to_bin_id.max(lower_bin_id);
            (start_bin_id, from_bin_id)
        } else {
            let end_bin_id = to_bin_id.min(upper_bin_id);
            (from_bin_id, end_bin_id)
        };

        let start_bin_index = self.get_bin_index_internal(start_bin_id)?;
        let end_bin_index = self.get_bin_index_internal(end_bin_id)?;

        for i in start_bin_index..=end_bin_index {
            if !self.bins[i].is_zero_liquidity() {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use crate::state::position::Position;

    use super::*;
    use proptest::proptest;
    trait BinArrayExt {
        fn new(index: i64, lb_pair: Pubkey) -> Self;
    }

    impl BinArrayExt for BinArray {
        fn new(index: i64, lb_pair: Pubkey) -> Self {
            Self {
                index,
                lb_pair,
                bins: [Bin::default(); MAX_BIN_PER_ARRAY],
                version: LayoutVersion::V1.into(),
                _padding: [0u8; 7],
            }
        }
    }

    struct TestBinArray {
        index: i32,
        bin_ids: Vec<i32>,
    }

    proptest! {
        #[test]
        fn test_is_zero_liquidity_in_range(
            from_bin_id in -436704..=436704,
            bin_id in -436704..=436704,
            flip_id in -436704..=436704) {
                let bin_array_index = BinArray::bin_id_to_bin_array_index(flip_id).unwrap();
                let mut bin_array = BinArray::new(bin_array_index.into(), Pubkey::default());

                // init liquidity
                let bin_array_index_offset = bin_array.get_bin_index_in_array(flip_id).unwrap();
                bin_array.bins[bin_array_index_offset].liquidity_supply = 1;

                if bin_array.is_bin_id_within_range(from_bin_id).is_ok() {
                    let is_zero_liquidity = bin_array.is_zero_liquidity_in_range(from_bin_id, bin_id).unwrap();

                    let min_id = from_bin_id.min(bin_id);
                    let max_id = from_bin_id.max(bin_id);
                    if flip_id >= min_id && flip_id <= max_id {
                        assert!(!is_zero_liquidity);
                    }else{
                        assert!(is_zero_liquidity);
                    }
                }
            }
    }
    #[test]
    fn test_bin_id_to_bin_array_index() {
        // Populate 4 bin arrays to the left, and right, starting from bin array index 0
        let bin_arrays_delta = 4;

        let mut right_bin_arrays = vec![];
        let mut id = 0;
        let mut bin_array_idx = 0;

        for _ in 0..bin_arrays_delta {
            let mut bins = vec![];
            for _ in 0..MAX_BIN_PER_ARRAY {
                bins.push(id);
                id = id + 1;
            }
            right_bin_arrays.push(TestBinArray {
                index: bin_array_idx,
                bin_ids: bins,
            });
            bin_array_idx = bin_array_idx + 1;
        }

        let mut left_bin_arrays = vec![];
        id = 0;
        bin_array_idx = 0;

        for _ in 0..bin_arrays_delta {
            let mut bins = vec![];
            for _ in 0..MAX_BIN_PER_ARRAY {
                id = id - 1;
                bins.push(id);
            }
            bin_array_idx = bin_array_idx - 1;
            let reversed_bins = bins.into_iter().rev().collect();
            left_bin_arrays.push(TestBinArray {
                index: bin_array_idx,
                bin_ids: reversed_bins,
            });
        }

        let continuous_bin_arrays: Vec<TestBinArray> = left_bin_arrays
            .into_iter()
            .rev()
            .chain(right_bin_arrays.into_iter())
            .collect();

        let mut prev = None;
        let mut min_bin_id = i32::MAX;
        let mut max_bin_id = i32::MIN;

        for bin_array in continuous_bin_arrays.iter() {
            assert_eq!(bin_array.bin_ids.len(), MAX_BIN_PER_ARRAY);

            for bin_id in bin_array.bin_ids.iter() {
                if let Some(prev) = prev {
                    assert_eq!(prev + 1, *bin_id);
                }
                prev = Some(bin_id);

                if *bin_id < min_bin_id {
                    min_bin_id = *bin_id;
                }
                if *bin_id > max_bin_id {
                    max_bin_id = *bin_id;
                }
            }
        }

        assert_eq!(min_bin_id, -280);
        // Because bin id 0 is positioned at positive side
        assert_eq!(max_bin_id, 279);

        for i in min_bin_id..=max_bin_id {
            let idx = BinArray::bin_id_to_bin_array_index(i).unwrap();
            let bin_array = continuous_bin_arrays
                .iter()
                .find(|ba| ba.index == idx)
                .unwrap();
            let result = bin_array.bin_ids.iter().find(|bid| **bid == i);
            if let None = result {
                println!("Bin id causing the error {}", i);
            }
            assert!(result.is_some());
        }
    }

    #[test]
    fn test_bin_array_lower_upper_bin_id_negative() {
        let bin_array_index = -1;
        let mut amount: i32 = -1;

        let mut bin_array = BinArray::new(bin_array_index, Pubkey::default());

        // Amount here is bin id, negate it and use for assertion later
        for i in (0..MAX_BIN_PER_ARRAY).rev() {
            bin_array.bins[i].amount_x = amount.unsigned_abs() as u64;
            bin_array.bins[i].amount_y = amount.unsigned_abs() as u64;
            amount -= 1;
        }

        let (lower, upper) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array.index as i32).unwrap();

        println!(
            "{} {} {:?} {:?}",
            lower,
            upper,
            bin_array.get_bin(lower).unwrap(),
            bin_array.get_bin(upper).unwrap()
        );

        assert_eq!(
            lower,
            (bin_array.get_bin(lower).unwrap().amount_x as i32).wrapping_neg()
        );
        assert_eq!(
            upper,
            (bin_array.get_bin(upper).unwrap().amount_x as i32).wrapping_neg()
        );

        bin_array.index -= 1;

        for i in (0..MAX_BIN_PER_ARRAY).rev() {
            bin_array.bins[i].amount_x = amount.unsigned_abs() as u64;
            bin_array.bins[i].amount_y = amount.unsigned_abs() as u64;
            amount -= 1;
        }

        let (lower, upper) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array.index as i32).unwrap();

        println!(
            "{} {} {:?} {:?}",
            lower,
            upper,
            bin_array.get_bin(lower).unwrap(),
            bin_array.get_bin(upper).unwrap()
        );

        assert_eq!(
            lower,
            (bin_array.get_bin(lower).unwrap().amount_x as i32).wrapping_neg()
        );
        assert_eq!(
            upper,
            (bin_array.get_bin(upper).unwrap().amount_x as i32).wrapping_neg()
        );
    }

    #[test]
    fn test_bin_array_lower_upper_bin_id_positive() {
        let bin_array_index = 0;
        let mut amount = 0;

        let mut bin_array = BinArray::new(bin_array_index, Pubkey::default());

        // Amount here is bin id, used for assertion later
        for i in 0..MAX_BIN_PER_ARRAY {
            bin_array.bins[i].amount_x = amount;
            bin_array.bins[i].amount_y = amount;
            amount += 1;
        }

        let (lower, upper) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array.index as i32).unwrap();
        println!(
            "{} {} {:?} {:?}",
            lower,
            upper,
            bin_array.get_bin(lower).unwrap(),
            bin_array.get_bin(upper).unwrap()
        );

        assert_eq!(lower, bin_array.get_bin(lower).unwrap().amount_x as i32);
        assert_eq!(upper, bin_array.get_bin(upper).unwrap().amount_x as i32);

        bin_array.index += 1;

        for i in 0..MAX_BIN_PER_ARRAY {
            bin_array.bins[i].amount_x = amount;
            bin_array.bins[i].amount_y = amount;
            amount += 1;
        }

        let (lower, upper) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array.index as i32).unwrap();

        println!(
            "{} {} {:?} {:?}",
            lower,
            upper,
            bin_array.get_bin(lower).unwrap(),
            bin_array.get_bin(upper).unwrap()
        );

        assert_eq!(lower, bin_array.get_bin(lower).unwrap().amount_x as i32);
        assert_eq!(upper, bin_array.get_bin(upper).unwrap().amount_x as i32);
    }

    #[test]
    fn test_bin_negative() {
        let bin_id = -11514;
        let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id).unwrap();

        let mut bin_arrays = [[Bin::default(); MAX_BIN_PER_ARRAY]; 195];
        let mut amount: i64 = -1;

        for arr in bin_arrays.iter_mut().rev() {
            for bin in arr.iter_mut().rev() {
                bin.amount_x = amount.unsigned_abs();
                bin.amount_y = amount.unsigned_abs();
                amount -= 1;
            }
        }

        let mut bin_array = BinArray::new(bin_array_index as i64, Pubkey::default());
        bin_array.bins = bin_arrays[(195 - bin_array_index.abs()) as usize];

        let bin = bin_array.get_bin(bin_id).unwrap();
        println!("{:?}", bin);
        assert_eq!((bin.amount_x as i32).wrapping_neg(), bin_id);

        let bin_id = -1332;
        let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id).unwrap();

        let mut bin_array = BinArray::new(bin_array_index as i64, Pubkey::default());
        bin_array.bins = bin_arrays[(195 - bin_array_index.abs()) as usize];

        let bin = bin_array.get_bin(bin_id).unwrap();
        println!("{:?}", bin);
        assert_eq!((bin.amount_x as i32).wrapping_neg(), bin_id);

        let bin_id = -66;
        let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id).unwrap();

        let mut bin_array = BinArray::new(bin_array_index as i64, Pubkey::default());
        bin_array.bins = bin_arrays[(195 - bin_array_index.abs()) as usize];

        let bin = bin_array.get_bin(bin_id).unwrap();
        println!("{:?}", bin);
        assert_eq!((bin.amount_x as i32).wrapping_neg(), bin_id);
    }

    #[test]
    fn test_bin_positive() {
        let bin_id = 5645;
        let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id).unwrap();
        let mut bin_arrays = [[Bin::default(); MAX_BIN_PER_ARRAY]; 195];

        let mut amount = 0;

        for arr in bin_arrays.iter_mut() {
            for bin in arr.iter_mut() {
                bin.amount_x = amount;
                bin.amount_y = amount;
                amount += 1;
            }
        }

        let mut bin_array = BinArray::new(bin_array_index as i64, Pubkey::default());
        bin_array.bins = bin_arrays[bin_array_index as usize];

        let bin = bin_array.get_bin(bin_id).unwrap();
        assert_eq!(bin.amount_x, bin_id as u64);
        println!("{:?}", bin);

        let bin_id = 10532;
        let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id).unwrap();

        let mut bin_array = BinArray::new(bin_array_index as i64, Pubkey::default());
        bin_array.bins = bin_arrays[bin_array_index as usize];

        let bin = bin_array.get_bin(bin_id).unwrap();
        assert_eq!(bin.amount_x, bin_id as u64);
        println!("{:?}", bin);

        let bin_id = 252;
        let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id).unwrap();

        let mut bin_array = BinArray::new(bin_array_index as i64, Pubkey::default());
        bin_array.bins = bin_arrays[bin_array_index as usize];

        let bin = bin_array.get_bin(bin_id).unwrap();
        assert_eq!(bin.amount_x, bin_id as u64);
        println!("{:?}", bin);
    }

    #[test]
    fn test_bin_array_size() {
        let bin_array_size = std::mem::size_of::<TestBinArray>();
        println!("BinArray size {:?}", bin_array_size);

        let bin_size = std::mem::size_of::<Bin>();
        println!("Bin size {:?}", bin_size);

        let max_size = 10240;

        println!(
            "No of bin can fit into {} bytes, {} bins",
            max_size,
            (max_size - 32 * 2) / bin_size
        );

        let remaining = max_size - bin_array_size - 8;
        println!("remaining bytes {:?}", remaining);

        let bin_size = std::mem::size_of::<Bin>();
        println!("remaining bins {:?}", remaining / bin_size);
    }

    #[test]
    fn test_bin_array_and_position_size() {
        println!(
            "Bin array size {:?} Position size {:?}",
            std::mem::size_of::<BinArray>(),
            std::mem::size_of::<Position>()
        );
    }
}
