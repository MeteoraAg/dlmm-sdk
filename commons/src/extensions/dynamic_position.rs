use crate::*;
use solana_sdk::pubkey::Pubkey;
use std::collections::HashMap;

use super::bin_array::BinArrayExtension;

pub const POSITION_MIN_SIZE: usize = std::mem::size_of::<PositionV2>();
pub const POSITION_BIN_DATA_SIZE: usize = std::mem::size_of::<PositionBinData>();

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/// Per-bin computed data for a position.
#[derive(Debug, Clone)]
pub struct DynamicPositionBinData {
    pub bin_id: i32,
    pub price: u128,
    pub bin_x_amount: u64,
    pub bin_y_amount: u64,
    pub bin_liquidity: u128,
    pub position_liquidity: u128,
    pub position_x_amount: u64,
    pub position_y_amount: u64,
    pub position_fee_x_amount: u64,
    pub position_fee_y_amount: u64,
    pub position_reward_amounts: [u64; NUM_REWARDS],
}

/// Aggregated position data computed from on-chain state.
#[derive(Debug, Clone)]
pub struct DynamicPosition {
    pub lb_pair: Pubkey,
    pub owner: Pubkey,
    pub fee_owner: Pubkey,
    pub lower_bin_id: i32,
    pub upper_bin_id: i32,
    pub total_x_amount: u64,
    pub total_y_amount: u64,
    pub fee_x: u64,
    pub fee_y: u64,
    pub reward_one: u64,
    pub reward_two: u64,
    pub last_updated_at: i64,
    pub total_claimed_fee_x_amount: u64,
    pub total_claimed_fee_y_amount: u64,
    pub bins: Vec<DynamicPositionBinData>,
}

impl DynamicPosition {
    fn decode_reward_per_token_stored(bin: &Bin) -> [u128; NUM_REWARDS] {
        let mut reward_0_bytes = [0u8; 16];
        reward_0_bytes[0..8].copy_from_slice(&bin.fulfilled_order_amount_x.to_le_bytes());
        reward_0_bytes[8..16].copy_from_slice(&bin.fulfilled_order_amount_y.to_le_bytes());
        let reward0 = u128::from_le_bytes(reward_0_bytes);

        let mut reward_1_bytes = [0u8; 16];
        reward_1_bytes[0..8].copy_from_slice(&bin.limit_order_fee_ask_side.to_le_bytes());
        reward_1_bytes[8..16].copy_from_slice(&bin.limit_order_fee_bid_side.to_le_bytes());
        let reward1 = u128::from_le_bytes(reward_1_bytes);

        [reward0, reward1]
    }

    fn compute_claimable_fee(
        liquidity_share: u128,
        bin_fee_per_token: u128,
        fee_per_token_complete: u128,
        fee_pending: u64,
    ) -> Result<u64> {
        if liquidity_share == 0 {
            return Ok(fee_pending);
        }
        let scaled_share = liquidity_share >> SCALE_OFFSET as u32;
        let fee_delta = bin_fee_per_token.saturating_sub(fee_per_token_complete);
        let new_fee: u64 = mul_shr(scaled_share, fee_delta, SCALE_OFFSET, Rounding::Down)
            .and_then(|v| v.try_into().ok())
            .unwrap_or(0);
        new_fee.checked_add(fee_pending).context("overflow")
    }

    pub fn parse(
        position: &PositionV2,
        account_data: &[u8],
        lb_pair: &LbPair,
        bin_arrays: &HashMap<i32, BinArray>,
        current_timestamp: i64,
    ) -> Result<DynamicPosition> {
        let lower_bin_id = position.lower_bin_id;
        let upper_bin_id = position.upper_bin_id;
        let support_limit_order = lb_pair.is_support_limit_order();
        let width = (upper_bin_id - lower_bin_id + 1) as usize;
        let base_count = position.liquidity_shares.len();

        // Combine base + extended bin data
        let mut position_bin_data = Vec::with_capacity(width);
        for i in 0..base_count.min(width) {
            position_bin_data.push(PositionBinData {
                liquidity_share: position.liquidity_shares[i],
                reward_info: position.reward_infos[i],
                fee_info: position.fee_infos[i],
            });
        }

        let extended_count = width.saturating_sub(base_count);
        if extended_count > 0 {
            let extended_bytes = &account_data[8 + POSITION_MIN_SIZE..];
            for i in 0..extended_count {
                let offset = i * POSITION_BIN_DATA_SIZE;
                ensure!(
                    offset + POSITION_BIN_DATA_SIZE <= extended_bytes.len(),
                    "account data too short for extended bin {}",
                    base_count + i
                );
                let bin_data: PositionBinData = bytemuck::pod_read_unaligned(
                    &extended_bytes[offset..offset + POSITION_BIN_DATA_SIZE],
                );
                position_bin_data.push(bin_data);
            }
        }

        let mut bins = Vec::with_capacity(width);
        let mut total_x_amount: u64 = 0;
        let mut total_y_amount: u64 = 0;
        let mut fee_x: u64 = 0;
        let mut fee_y: u64 = 0;
        let mut rewards = [0u64; NUM_REWARDS];

        for bin_id in lower_bin_id..=upper_bin_id {
            let idx = (bin_id - lower_bin_id) as usize;
            let liquidity_share = position_bin_data[idx].liquidity_share;
            let fee_info = &position_bin_data[idx].fee_info;
            let reward_info = &position_bin_data[idx].reward_info;

            let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id)?;
            let bin = bin_arrays
                .get(&bin_array_index)
                .map(|ba| ba.get_bin(bin_id))
                .transpose()?;

            let (
                bin_x_amount,
                bin_y_amount,
                bin_liquidity,
                bin_fee_x_per_token,
                bin_fee_y_per_token,
                bin_price,
            ) = match bin {
                Some(b) => (
                    b.amount_x,
                    b.amount_y,
                    b.liquidity_supply,
                    b.fee_amount_x_per_token_stored,
                    b.fee_amount_y_per_token_stored,
                    b.price,
                ),
                None => (0, 0, 0, 0, 0, 0),
            };

            // Position's share of bin amounts
            let (position_x_amount, position_y_amount) =
                if bin_liquidity == 0 || liquidity_share == 0 {
                    (0u64, 0u64)
                } else {
                    (
                        safe_mul_div_cast(
                            liquidity_share,
                            bin_x_amount.into(),
                            bin_liquidity,
                            Rounding::Down,
                        )?,
                        safe_mul_div_cast(
                            liquidity_share,
                            bin_y_amount.into(),
                            bin_liquidity,
                            Rounding::Down,
                        )?,
                    )
                };

            total_x_amount = total_x_amount
                .checked_add(position_x_amount)
                .context("overflow")?;
            total_y_amount = total_y_amount
                .checked_add(position_y_amount)
                .context("overflow")?;

            // Claimable fees
            let claimable_fee_x = Self::compute_claimable_fee(
                liquidity_share,
                bin_fee_x_per_token,
                fee_info.fee_x_per_token_complete,
                fee_info.fee_x_pending,
            )?;
            let claimable_fee_y = Self::compute_claimable_fee(
                liquidity_share,
                bin_fee_y_per_token,
                fee_info.fee_y_per_token_complete,
                fee_info.fee_y_pending,
            )?;

            fee_x = fee_x.checked_add(claimable_fee_x).context("overflow")?;
            fee_y = fee_y.checked_add(claimable_fee_y).context("overflow")?;

            // Claimable rewards (only for non-limit-order pools)
            let mut bin_rewards = [0u64; NUM_REWARDS];
            if !support_limit_order {
                let bin_reward_per_token_stored = match bin {
                    Some(b) => Self::decode_reward_per_token_stored(b),
                    None => [0u128; NUM_REWARDS],
                };

                for j in 0..NUM_REWARDS {
                    let pair_reward_info = &lb_pair.reward_infos[j];
                    if pair_reward_info.mint == Pubkey::default() {
                        continue;
                    }

                    let mut reward_per_token_stored = bin_reward_per_token_stored[j];

                    // Accrue pending rewards for active bin
                    if bin_id == lb_pair.active_id && bin_liquidity > 0 {
                        let current_time = std::cmp::min(
                            current_timestamp as u64,
                            pair_reward_info.reward_duration_end,
                        );
                        let delta = current_time.saturating_sub(pair_reward_info.last_update_time);
                        let liquidity_supply_scaled = bin_liquidity >> SCALE_OFFSET as u32;
                        if liquidity_supply_scaled > 0 && delta > 0 {
                            let reward_delta = pair_reward_info
                                .reward_rate
                                .checked_mul(delta.into())
                                .and_then(|v| v.checked_div(MAX_REWARD_BIN_SPLIT as u128))
                                .and_then(|v| v.checked_div(liquidity_supply_scaled))
                                .unwrap_or(0);
                            reward_per_token_stored =
                                reward_per_token_stored.saturating_add(reward_delta);
                        }
                    }

                    let delta = reward_per_token_stored
                        .saturating_sub(reward_info.reward_per_token_completes[j]);

                    let new_reward: u64 = if liquidity_share == 0 {
                        0
                    } else {
                        let scaled_share = liquidity_share >> SCALE_OFFSET as u32;
                        mul_shr(delta, scaled_share, SCALE_OFFSET, Rounding::Down)
                            .and_then(|v| v.try_into().ok())
                            .unwrap_or(0)
                    };

                    let claimable_reward = new_reward
                        .checked_add(reward_info.reward_pendings[j])
                        .context("overflow")?;

                    bin_rewards[j] = claimable_reward;
                    rewards[j] = rewards[j]
                        .checked_add(claimable_reward)
                        .context("overflow")?;
                }
            }

            bins.push(DynamicPositionBinData {
                bin_id,
                price: bin_price,
                bin_x_amount,
                bin_y_amount,
                bin_liquidity,
                position_liquidity: liquidity_share,
                position_x_amount,
                position_y_amount,
                position_fee_x_amount: claimable_fee_x,
                position_fee_y_amount: claimable_fee_y,
                position_reward_amounts: bin_rewards,
            });
        }

        Ok(DynamicPosition {
            lb_pair: position.lb_pair,
            owner: position.owner,
            fee_owner: position.fee_owner,
            lower_bin_id,
            upper_bin_id,
            total_x_amount,
            total_y_amount,
            fee_x,
            fee_y,
            reward_one: rewards[0],
            reward_two: rewards[1],
            last_updated_at: position.last_updated_at,
            total_claimed_fee_x_amount: position.total_claimed_fee_x_amount,
            total_claimed_fee_y_amount: position.total_claimed_fee_y_amount,
            bins,
        })
    }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

impl std::fmt::Display for DynamicPosition {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(f, "LB Pair:          {}", self.lb_pair)?;
        writeln!(f, "Owner:            {}", self.owner)?;
        writeln!(f, "Fee Owner:        {}", self.fee_owner)?;
        writeln!(
            f,
            "Bin Range:        [{}, {}]",
            self.lower_bin_id, self.upper_bin_id
        )?;
        writeln!(f, "Total X Amount:   {}", self.total_x_amount)?;
        writeln!(f, "Total Y Amount:   {}", self.total_y_amount)?;
        writeln!(f, "Fee X:            {}", self.fee_x)?;
        writeln!(f, "Fee Y:            {}", self.fee_y)?;
        writeln!(f, "Reward One:       {}", self.reward_one)?;
        writeln!(f, "Reward Two:       {}", self.reward_two)?;
        writeln!(f, "Claimed Fee X:    {}", self.total_claimed_fee_x_amount)?;
        writeln!(f, "Claimed Fee Y:    {}", self.total_claimed_fee_y_amount)?;
        writeln!(f, "Last Updated:     {}", self.last_updated_at)?;

        let active_bins: Vec<_> = self
            .bins
            .iter()
            .filter(|b| {
                b.position_liquidity > 0
                    || b.position_fee_x_amount > 0
                    || b.position_fee_y_amount > 0
            })
            .collect();

        if !active_bins.is_empty() {
            writeln!(f, "Active Bins ({}):", active_bins.len())?;
            for b in active_bins {
                writeln!(
                    f,
                    "  Bin {:>7} | X: {:>20} Y: {:>20} | Fee X: {:>15} Fee Y: {:>15} | Reward: [{}, {}]",
                    b.bin_id,
                    b.position_x_amount,
                    b.position_y_amount,
                    b.position_fee_x_amount,
                    b.position_fee_y_amount,
                    b.position_reward_amounts[0],
                    b.position_reward_amounts[1],
                )?;
            }
        }

        std::result::Result::Ok(())
    }
}
