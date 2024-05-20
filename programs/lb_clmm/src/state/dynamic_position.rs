use super::position::PositionV2;
use crate::constants::NUM_REWARDS;
use crate::errors::LBError;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::safe_math::SafeMath;
use crate::math::u128x128_math::Rounding;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::math::utils_math::safe_mul_shr_cast;
use crate::state::bin::Bin;
use crate::state::position::Position;
use crate::state::position::{FeeInfo, UserRewardInfo};
use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use num_traits::Zero;
use std::cell::RefMut;
#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Side of resize, 0 for lower and 1 for upper
pub enum ResizeSide {
    Lower,
    Upper,
}

pub fn get_idx(bin_id: i32, lower_bin_id: i32) -> Result<usize> {
    Ok(bin_id.safe_sub(lower_bin_id)? as usize)
}

/// Extension trait for loading dynamic-sized data in a zero-copy dynamic position account.
pub trait DynamicPositionLoader<'info> {
    fn load_content_mut<'a>(&'a self) -> Result<DynamicPosition<'a>>;
    fn load_content_init<'a>(&'a self) -> Result<DynamicPosition<'a>>;
    fn load_content<'a>(&'a self) -> Result<DynamicPosition<'a>>;
}

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct PositionV3 {
    /// The LB pair of this position
    pub lb_pair: Pubkey,
    /// Owner of the position. Client rely on this to to fetch their positions.
    pub owner: Pubkey,
    /// Lower bin ID
    pub lower_bin_id: i32,
    /// Upper bin ID
    pub upper_bin_id: i32,
    /// Last updated timestamp
    pub last_updated_at: i64,
    /// Total claimed token fee X
    pub total_claimed_fee_x_amount: u64,
    /// Total claimed token fee Y
    pub total_claimed_fee_y_amount: u64,
    /// Total claimed rewards
    pub total_claimed_rewards: [u64; 2],
    /// Operator of position
    pub operator: Pubkey,
    /// Slot which the locked liquidity can be withdraw
    pub lock_release_slot: u64,
    /// Is the position subjected to liquidity locking for the launch pool.
    pub subjected_to_bootstrap_liquidity_locking: u8,
    /// Padding
    pub padding_0: [u8; 7],
    /// Address is able to claim fee in this position, only valid for bootstrap_liquidity_position
    pub fee_owner: Pubkey,
    /// Number of bins
    pub length: u64,
    /// Reserved space for future use
    pub _reserved: [u8; 128],
}

impl Default for PositionV3 {
    fn default() -> Self {
        Self {
            lb_pair: Pubkey::default(),
            owner: Pubkey::default(),
            lower_bin_id: 0,
            upper_bin_id: 0,
            last_updated_at: 0,
            total_claimed_fee_x_amount: 0,
            total_claimed_fee_y_amount: 0,
            total_claimed_rewards: [0u64; 2],
            operator: Pubkey::default(),
            lock_release_slot: 0,
            subjected_to_bootstrap_liquidity_locking: 0,
            padding_0: [0u8; 7],
            fee_owner: Pubkey::default(),
            length: 0,
            _reserved: [0u8; 128],
        }
    }
}

impl PositionV3 {
    pub fn init(
        &mut self,
        lb_pair: Pubkey,
        owner: Pubkey,
        operator: Pubkey,
        lower_bin_id: i32,
        upper_bin_id: i32,
        width: i32,
        current_time: i64,
        seed_liquidity_release_slot: u64,
        subjected_to_initial_liquidity_locking: bool,
        fee_owner: Pubkey,
    ) -> Result<()> {
        self.lb_pair = lb_pair;
        self.owner = owner;
        self.operator = operator;

        self.lower_bin_id = lower_bin_id;
        self.upper_bin_id = upper_bin_id;

        self.length = width as u64;

        self.last_updated_at = current_time;

        self.lock_release_slot = seed_liquidity_release_slot;
        self.subjected_to_bootstrap_liquidity_locking =
            subjected_to_initial_liquidity_locking.into();
        self.fee_owner = fee_owner;

        Ok(())
    }

    pub fn increase_length(&mut self, length_to_increase: u64) -> Result<()> {
        self.length = self.length.safe_add(length_to_increase)?;
        Ok(())
    }

    pub fn space(bin_count: usize) -> usize {
        8 + PositionV3::INIT_SPACE + bin_count as usize * PositionBinData::INIT_SPACE
    }

    pub fn new_space_after_add(
        length_to_add: u64,
        account_loader: &AccountLoader<'_, PositionV3>,
    ) -> Result<usize> {
        let global_data = account_loader.load()?;
        Ok(PositionV3::space(
            (global_data.length.safe_add(length_to_add)?) as usize,
        ))
    }

    pub fn new_space_after_remove(
        length_to_remove: u64,
        account_loader: &AccountLoader<'_, PositionV3>,
    ) -> Result<usize> {
        let global_data = account_loader.load()?;
        Ok(PositionV3::space(
            (global_data.length.safe_sub(length_to_remove)?) as usize,
        ))
    }

    pub fn accumulate_total_claimed_fees(&mut self, fee_x: u64, fee_y: u64) {
        self.total_claimed_fee_x_amount = self.total_claimed_fee_x_amount.wrapping_add(fee_x);
        self.total_claimed_fee_y_amount = self.total_claimed_fee_y_amount.wrapping_add(fee_y);
    }

    pub fn accumulate_total_claimed_rewards(&mut self, reward_index: usize, reward: u64) {
        let total_claimed_reward = self.total_claimed_rewards[reward_index];
        self.total_claimed_rewards[reward_index] = total_claimed_reward.wrapping_add(reward);
    }

    pub fn is_subjected_to_initial_liquidity_locking(&self) -> bool {
        self.subjected_to_bootstrap_liquidity_locking != 0
    }
    pub fn set_lock_release_slot(&mut self, lock_release_slot: u64) {
        self.lock_release_slot = lock_release_slot;
    }
}

/// An position struct loaded with dynamic sized data type
#[derive(Debug)]
pub struct DynamicPosition<'a> {
    global_data: RefMut<'a, PositionV3>,
    position_bin_data: RefMut<'a, [PositionBinData]>,
}

impl<'a> DynamicPosition<'a> {
    pub fn increase_length(&mut self, length_to_add: u64, side: ResizeSide) -> Result<()> {
        self.global_data.length = self.global_data.length.safe_add(length_to_add)?;
        match side {
            ResizeSide::Lower => {
                self.global_data.lower_bin_id = self
                    .global_data
                    .lower_bin_id
                    .safe_sub(length_to_add as i32)?;
                // shift position_bin_data to right
                self.position_bin_data.rotate_right(length_to_add as usize);
            }
            ResizeSide::Upper => {
                self.global_data.upper_bin_id = self
                    .global_data
                    .upper_bin_id
                    .safe_add(length_to_add as i32)?;
            }
        }
        Ok(())
    }

    pub fn decrease_length(&mut self, length_to_remove: u64, side: ResizeSide) -> Result<()> {
        self.global_data.length = self.global_data.length.safe_sub(length_to_remove)?;
        match side {
            ResizeSide::Lower => {
                self.global_data.lower_bin_id = self
                    .global_data
                    .lower_bin_id
                    .safe_add(length_to_remove as i32)?;
                // shift position_bin_data to left
                self.position_bin_data
                    .rotate_left(length_to_remove as usize);
            }
            ResizeSide::Upper => {
                self.global_data.upper_bin_id = self
                    .global_data
                    .upper_bin_id
                    .safe_sub(length_to_remove as i32)?;
            }
        }
        Ok(())
    }
    pub fn set_last_updated_at(&mut self, current_time: i64) {
        self.global_data.last_updated_at = current_time;
    }
    /// Update reward + fee earning
    pub fn update_earning_per_token_stored(
        &mut self,
        bin_array_manager: &BinArrayManager,
        min_bin_id: i32,
        max_bin_id: i32,
    ) -> Result<()> {
        self.assert_valid_bin_range_for_modify_position(min_bin_id, max_bin_id)?;
        let (bin_arrays_lower_bin_id, bin_arrays_upper_bin_id) =
            bin_array_manager.get_lower_upper_bin_id()?;

        require!(
            min_bin_id >= bin_arrays_lower_bin_id && max_bin_id <= bin_arrays_upper_bin_id,
            LBError::InvalidBinArray
        );

        for bin_id in min_bin_id..=max_bin_id {
            let bin = bin_array_manager.get_bin(bin_id)?;
            let idx = get_idx(bin_id, self.global_data.lower_bin_id)?;
            let bin_data = &mut self.position_bin_data[idx];
            bin_data.update_reward_per_token_stored(&bin)?;
            bin_data.update_fee_per_token_stored(&bin)?;
        }

        Ok(())
    }

    pub fn id_within_position(&self, id: i32) -> Result<()> {
        require!(
            id >= self.global_data.lower_bin_id && id <= self.global_data.upper_bin_id,
            LBError::InvalidPosition
        );
        Ok(())
    }

    pub fn deposit(&mut self, bin_id: i32, liquidity_share: u128) -> Result<()> {
        self.id_within_position(bin_id)?;
        let idx: usize = get_idx(bin_id, self.global_data.lower_bin_id)?;
        let bin_data = &mut self.position_bin_data[idx];
        bin_data.liquidity_share = bin_data.liquidity_share.safe_add(liquidity_share)?;
        Ok(())
    }

    pub fn claim_fee(&mut self, min_bin_id: i32, max_bin_id: i32) -> Result<(u64, u64)> {
        self.assert_valid_bin_range_for_modify_position(min_bin_id, max_bin_id)?;

        let mut fee_x = 0;
        let mut fee_y = 0;
        let min_idx = get_idx(min_bin_id, self.global_data.lower_bin_id)?;
        let max_idx = get_idx(max_bin_id, self.global_data.lower_bin_id)?;

        for idx in min_idx..=max_idx {
            let fee_info = &mut self.position_bin_data[idx].fee_info;
            fee_x = fee_x.safe_add(fee_info.fee_x_pending)?;
            fee_info.fee_x_pending = 0;

            fee_y = fee_y.safe_add(fee_info.fee_y_pending)?;
            fee_info.fee_y_pending = 0;
        }
        Ok((fee_x, fee_y))
    }

    pub fn accumulate_total_claimed_fees(&mut self, fee_x: u64, fee_y: u64) {
        self.global_data.accumulate_total_claimed_fees(fee_x, fee_y)
    }

    pub fn owner(&self) -> Pubkey {
        self.global_data.owner
    }

    pub fn fee_owner(&self) -> Pubkey {
        self.global_data.fee_owner
    }

    pub fn lower_bin_id(&self) -> i32 {
        self.global_data.lower_bin_id
    }

    pub fn upper_bin_id(&self) -> i32 {
        self.global_data.upper_bin_id
    }

    pub fn lb_pair(&self) -> Pubkey {
        self.global_data.lb_pair
    }

    pub fn length(&self) -> u64 {
        self.global_data.length
    }

    pub fn assert_valid_bin_range_for_modify_position(
        &self,
        min_bin_id: i32,
        max_bin_id: i32,
    ) -> Result<()> {
        require!(
            min_bin_id >= self.global_data.lower_bin_id
                && max_bin_id <= self.global_data.upper_bin_id,
            LBError::InvalidPosition
        );
        Ok(())
    }

    pub fn get_total_reward(
        &self,
        reward_index: usize,
        min_bin_id: i32,
        max_bin_id: i32,
    ) -> Result<u64> {
        self.assert_valid_bin_range_for_modify_position(min_bin_id, max_bin_id)?;
        let mut total_reward = 0;

        let min_idx = get_idx(min_bin_id, self.global_data.lower_bin_id)?;
        let max_idx = get_idx(max_bin_id, self.global_data.lower_bin_id)?;
        for idx in min_idx..=max_idx {
            total_reward = total_reward
                .safe_add(self.position_bin_data[idx].reward_info.reward_pendings[reward_index])?;
        }
        Ok(total_reward)
    }

    pub fn reset_all_pending_reward(
        &mut self,
        reward_index: usize,
        min_bin_id: i32,
        max_bin_id: i32,
    ) -> Result<()> {
        self.assert_valid_bin_range_for_modify_position(min_bin_id, max_bin_id)?;
        let min_idx = get_idx(min_bin_id, self.global_data.lower_bin_id)?;
        let max_idx = get_idx(max_bin_id, self.global_data.lower_bin_id)?;
        for idx in min_idx..=max_idx {
            self.position_bin_data[idx].reward_info.reward_pendings[reward_index] = 0;
        }
        Ok(())
    }

    pub fn accumulate_total_claimed_rewards(&mut self, reward_index: usize, reward: u64) {
        self.global_data
            .accumulate_total_claimed_rewards(reward_index, reward)
    }

    /// Position is empty when rewards is 0, fees is 0, and liquidity share is 0.
    pub fn is_empty(&self, min_bin_id: i32, max_bin_id: i32) -> Result<bool> {
        self.assert_valid_bin_range_for_modify_position(min_bin_id, max_bin_id)?;
        let min_idx = get_idx(min_bin_id, self.global_data.lower_bin_id)?;
        let max_idx = get_idx(max_bin_id, self.global_data.lower_bin_id)?;
        for idx in min_idx..=max_idx {
            let position_bin_data = &self.position_bin_data[idx];
            if !position_bin_data.liquidity_share.is_zero() {
                return Ok(false);
            }
            let reward_infos = &position_bin_data.reward_info;

            for reward_pending in reward_infos.reward_pendings {
                if !reward_pending.is_zero() {
                    return Ok(false);
                }
            }

            let fee_infos = &position_bin_data.fee_info;
            if !fee_infos.fee_x_pending.is_zero() || !fee_infos.fee_y_pending.is_zero() {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub fn get_liquidity_share_in_bin(&self, bin_id: i32) -> Result<u128> {
        self.id_within_position(bin_id)?;
        let idx = get_idx(bin_id, self.global_data.lower_bin_id)?;
        Ok(self.position_bin_data[idx].liquidity_share)
    }

    pub fn withdraw(&mut self, bin_id: i32, liquidity_share: u128) -> Result<()> {
        self.id_within_position(bin_id)?;
        let idx = get_idx(bin_id, self.global_data.lower_bin_id)?;
        let position_bin_data = &mut self.position_bin_data[idx];
        position_bin_data.liquidity_share = position_bin_data
            .liquidity_share
            .safe_sub(liquidity_share)?;

        Ok(())
    }

    pub fn migrate_from_v1(&mut self, position: &Position) -> Result<()> {
        self.global_data.lb_pair = position.lb_pair;
        self.global_data.owner = position.owner;
        self.global_data.lower_bin_id = position.lower_bin_id;
        self.global_data.upper_bin_id = position.upper_bin_id;
        self.global_data.last_updated_at = position.last_updated_at;
        self.global_data.total_claimed_fee_x_amount = position.total_claimed_fee_x_amount;
        self.global_data.total_claimed_fee_y_amount = position.total_claimed_fee_y_amount;
        self.global_data.total_claimed_rewards = position.total_claimed_rewards;
        let width = position.width();
        self.global_data.length = width as u64;

        for i in 0..width {
            let position_bin_data = &mut self.position_bin_data[i];
            position_bin_data.liquidity_share =
                u128::from(position.liquidity_shares[i]).safe_shl(SCALE_OFFSET.into())?;
            position_bin_data.reward_info = position.reward_infos[i];
            position_bin_data.fee_info = position.fee_infos[i];
        }
        Ok(())
    }

    pub fn migrate_from_v2(&mut self, position: &PositionV2) -> Result<()> {
        self.global_data.lb_pair = position.lb_pair;
        self.global_data.owner = position.owner;
        self.global_data.lower_bin_id = position.lower_bin_id;
        self.global_data.upper_bin_id = position.upper_bin_id;
        self.global_data.last_updated_at = position.last_updated_at;
        self.global_data.total_claimed_fee_x_amount = position.total_claimed_fee_x_amount;
        self.global_data.total_claimed_fee_y_amount = position.total_claimed_fee_y_amount;
        self.global_data.total_claimed_rewards = position.total_claimed_rewards;
        let width = position.width();
        self.global_data.length = width as u64;
        self.global_data.operator = position.operator;
        self.global_data.subjected_to_bootstrap_liquidity_locking =
            position.subjected_to_bootstrap_liquidity_locking;
        self.global_data.lock_release_slot = position.lock_release_slot;
        self.global_data.fee_owner = position.fee_owner;

        for i in 0..width {
            let position_bin_data = &mut self.position_bin_data[i];
            position_bin_data.liquidity_share = position.liquidity_shares[i];
            position_bin_data.reward_info = position.reward_infos[i];
            position_bin_data.fee_info = position.fee_infos[i];
        }
        Ok(())
    }

    pub fn is_liquidity_locked(&self, current_slot: u64) -> bool {
        current_slot < self.global_data.lock_release_slot
    }
}

impl PositionBinData {
    fn update_fee_per_token_stored(&mut self, bin: &Bin) -> Result<()> {
        let fee_infos = &mut self.fee_info;

        let fee_x_per_token_stored = bin.fee_amount_x_per_token_stored;

        let new_fee_x: u64 = safe_mul_shr_cast(
            self.liquidity_share
                .safe_shr(SCALE_OFFSET.into())?
                .try_into()
                .map_err(|_| LBError::TypeCastFailed)?,
            fee_x_per_token_stored.safe_sub(fee_infos.fee_x_per_token_complete)?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        fee_infos.fee_x_pending = new_fee_x.safe_add(fee_infos.fee_x_pending)?;
        fee_infos.fee_x_per_token_complete = fee_x_per_token_stored;

        let fee_y_per_token_stored = bin.fee_amount_y_per_token_stored;

        let new_fee_y: u64 = safe_mul_shr_cast(
            self.liquidity_share
                .safe_shr(SCALE_OFFSET.into())?
                .try_into()
                .map_err(|_| LBError::TypeCastFailed)?,
            fee_y_per_token_stored.safe_sub(fee_infos.fee_y_per_token_complete)?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        fee_infos.fee_y_pending = new_fee_y.safe_add(fee_infos.fee_y_pending)?;
        fee_infos.fee_y_per_token_complete = fee_y_per_token_stored;

        Ok(())
    }

    fn update_reward_per_token_stored(&mut self, bin: &Bin) -> Result<()> {
        let reward_info = &mut self.reward_info;
        for reward_idx in 0..NUM_REWARDS {
            let reward_per_token_stored = bin.reward_per_token_stored[reward_idx];

            let new_reward: u64 = safe_mul_shr_cast(
                self.liquidity_share
                    .safe_shr(SCALE_OFFSET.into())?
                    .try_into()
                    .map_err(|_| LBError::TypeCastFailed)?,
                reward_per_token_stored
                    .safe_sub(reward_info.reward_per_token_completes[reward_idx])?,
                SCALE_OFFSET,
                Rounding::Down,
            )?;

            reward_info.reward_pendings[reward_idx] =
                new_reward.safe_add(reward_info.reward_pendings[reward_idx])?;
            reward_info.reward_per_token_completes[reward_idx] = reward_per_token_stored;
        }

        Ok(())
    }
}
#[zero_copy]
#[derive(Default, Debug, AnchorDeserialize, AnchorSerialize, InitSpace, PartialEq)]
pub struct PositionBinData {
    pub liquidity_share: u128,
    pub reward_info: UserRewardInfo,
    pub fee_info: FeeInfo,
}

impl<'a> DynamicPosition<'a> {
    pub fn new(
        global_data: RefMut<'a, PositionV3>,
        position_bin_data: RefMut<'a, [PositionBinData]>,
    ) -> DynamicPosition<'a> {
        Self {
            global_data,
            position_bin_data,
        }
    }
}

fn position_account_split<'a, 'info>(
    position_al: &'a AccountLoader<'info, PositionV3>,
) -> Result<DynamicPosition<'a>> {
    let data = position_al.as_ref().try_borrow_mut_data()?;

    let (global_data, position_bin_data) = RefMut::map_split(data, |data| {
        let (global_bytes, position_bin_data_bytes) = data.split_at_mut(8 + PositionV3::INIT_SPACE);
        let global_data = bytemuck::from_bytes_mut::<PositionV3>(&mut global_bytes[8..]);
        let position_bin_data =
            bytemuck::cast_slice_mut::<u8, PositionBinData>(position_bin_data_bytes);
        (global_data, position_bin_data)
    });

    Ok(DynamicPosition::new(global_data, position_bin_data))
}

impl<'info> DynamicPositionLoader<'info> for AccountLoader<'info, PositionV3> {
    fn load_content_mut<'a>(&'a self) -> Result<DynamicPosition<'a>> {
        {
            // Re-use anchor internal validation such as discriminator check
            self.load_mut()?;
        }
        position_account_split(&self)
    }

    fn load_content_init<'a>(&'a self) -> Result<DynamicPosition<'a>> {
        {
            // Re-use anchor internal validation and initialization such as insert of discriminator for new zero copy account
            self.load_init()?;
        }
        position_account_split(&self)
    }

    fn load_content<'a>(&'a self) -> Result<DynamicPosition<'a>> {
        {
            // Re-use anchor internal validation and initialization such as insert of discriminator for new zero copy account
            self.load()?;
        }
        position_account_split(&self)
    }
}
