use std::cmp::min;

use super::bin::BinArray;
use super::parameters::{StaticParameters, VariableParameters};
use crate::constants::{
    BASIS_POINT_MAX, BIN_ARRAY_BITMAP_SIZE, FEE_PRECISION, MAX_BIN_ID, MAX_FEE_RATE,
    MAX_FEE_UPDATE_WINDOW, MIN_BIN_ID,
};
use crate::instructions::update_fee_parameters::FeeParameter;
use crate::math::u128x128_math::Rounding;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::math::utils_math::{one, safe_mul_div_cast, safe_mul_shr_cast, safe_shl_div_cast};
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::utils::seeds::PERMISSION;
use crate::{errors::LBError, math::safe_math::SafeMath};
use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use std::ops::BitXor;
use std::ops::Shl;
use std::ops::Shr;

use ruint::aliases::{U1024, U256};

#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Type of the Pair. 0 = Permissionless, 1 = Permission. Putting 0 as permissionless for backward compatibility.
pub enum PairType {
    Permissionless,
    Permission,
}

impl PairType {
    pub fn get_default_pair_status(&self) -> PairStatus {
        match self {
            Self::Permission => PairStatus::Disabled,
            Self::Permissionless => PairStatus::Enabled,
        }
    }
}

#[derive(Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Pair status. 0 = Enabled, 1 = Disabled. Putting 0 as enabled for backward compatibility.
pub enum PairStatus {
    Enabled,
    Disabled,
}

#[zero_copy]
#[derive(InitSpace, Default, Debug)]
pub struct ProtocolFee {
    pub amount_x: u64,
    pub amount_y: u64,
}

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct LbPair {
    pub parameters: StaticParameters,
    pub v_parameters: VariableParameters,
    pub bump_seed: [u8; 1],
    /// Bin step signer seed
    pub bin_step_seed: [u8; 2],
    /// Type of the pair
    pub pair_type: u8,
    /// Active bin id
    pub active_id: i32,
    /// Bin step. Represent the price increment / decrement.
    pub bin_step: u16,
    /// Status of the pair
    pub status: u8,
    pub _padding1: [u8; 5],
    /// Token X mint
    pub token_x_mint: Pubkey,
    /// Token Y mint
    pub token_y_mint: Pubkey,
    /// LB token X vault
    pub reserve_x: Pubkey,
    /// LB token Y vault
    pub reserve_y: Pubkey,
    /// Uncollected protocol fee
    pub protocol_fee: ProtocolFee,
    /// Protocol fee owner,
    pub fee_owner: Pubkey,
    /// Farming reward information
    pub reward_infos: [RewardInfo; 2], // TODO: Bug in anchor IDL parser when using InitSpace macro. Temp hardcode it. https://github.com/coral-xyz/anchor/issues/2556
    /// Oracle pubkey
    pub oracle: Pubkey,
    /// Packed initialized bin array state
    pub bin_array_bitmap: [u64; 16], // store default bin id from -512 to 511 (bin id from -35840 to 35840, price from 2.7e-16 to 3.6e15)
    /// Last time the pool fee parameter was updated
    pub last_updated_at: i64,
    /// Whitelisted wallet
    pub whitelisted_wallet: [Pubkey; 3],
    /// Reserved space for future use
    pub _reserved: [u8; 88],
}

impl Default for LbPair {
    fn default() -> Self {
        Self {
            active_id: 0,
            parameters: StaticParameters::default(),
            v_parameters: VariableParameters::default(),
            bump_seed: [0u8; 1],
            bin_step: 0,
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            bin_step_seed: [0u8; 2],
            fee_owner: Pubkey::default(),
            protocol_fee: ProtocolFee::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            reward_infos: [RewardInfo::default(); 2],
            oracle: Pubkey::default(),
            bin_array_bitmap: [0u64; 16],
            last_updated_at: 0,
            pair_type: PairType::Permissionless.into(),
            status: PairStatus::Enabled.into(),
            whitelisted_wallet: [Pubkey::default(); 3],
            _padding1: [0u8; 5],
            _reserved: [0u8; 88],
        }
    }
}

/// Stores the state relevant for tracking liquidity mining rewards
#[zero_copy]
#[derive(InitSpace, Default, Debug, PartialEq)]
pub struct RewardInfo {
    /// Reward token mint.
    pub mint: Pubkey,
    /// Reward vault token account.
    pub vault: Pubkey,
    /// Authority account that allows to fund rewards
    pub funder: Pubkey,
    /// TODO check whether we need to store it in pool
    pub reward_duration: u64, // 8
    /// TODO check whether we need to store it in pool
    pub reward_duration_end: u64, // 8
    /// TODO check whether we need to store it in pool
    pub reward_rate: u128, // 8
    /// The last time reward states were updated.
    pub last_update_time: u64, // 8
    /// Accumulated seconds where when farm distribute rewards, but the bin is empty. The reward will be accumulated for next reward time window.
    pub cumulative_seconds_with_empty_liquidity_reward: u64,
}

impl RewardInfo {
    /// Returns true if this reward is initialized.
    /// Once initialized, a reward cannot transition back to uninitialized.
    pub fn initialized(&self) -> bool {
        self.mint.ne(&Pubkey::default())
    }

    pub fn is_valid_funder(&self, funder: Pubkey) -> bool {
        funder.eq(&crate::admin::ID) || funder.eq(&self.funder)
    }

    pub fn init_reward(
        &mut self,
        mint: Pubkey,
        vault: Pubkey,
        funder: Pubkey,
        reward_duration: u64,
    ) {
        self.mint = mint;
        self.vault = vault;
        self.funder = funder;
        self.reward_duration = reward_duration;
    }

    pub fn update_last_update_time(&mut self, current_time: u64) {
        self.last_update_time = std::cmp::min(current_time, self.reward_duration_end);
    }

    pub fn get_seconds_elapsed_since_last_update(&self, current_time: u64) -> Result<u64> {
        let last_time_reward_applicable = std::cmp::min(current_time, self.reward_duration_end);
        let time_period = last_time_reward_applicable.safe_sub(self.last_update_time.into())?;

        Ok(time_period)
    }

    // To make it simple we truncate decimals of liquidity_supply for the calculation
    pub fn calculate_reward_per_token_stored_since_last_update(
        &self,
        current_time: u64,
        liquidity_supply: u64,
    ) -> Result<u128> {
        let time_period = self.get_seconds_elapsed_since_last_update(current_time)?;

        safe_mul_div_cast(
            time_period.into(),
            self.reward_rate,
            liquidity_supply.into(),
            Rounding::Down,
        )
    }

    pub fn calculate_reward_accumulated_since_last_update(
        &self,
        current_time: u64,
    ) -> Result<U256> {
        let last_time_reward_applicable = std::cmp::min(current_time, self.reward_duration_end);

        let time_period =
            U256::from(last_time_reward_applicable.safe_sub(self.last_update_time.into())?);

        Ok(time_period.safe_mul(U256::from(self.reward_rate))?)
    }

    /// Farming rate after funding
    pub fn update_rate_after_funding(
        &mut self,
        current_time: u64,
        funding_amount: u64,
    ) -> Result<()> {
        let reward_duration_end = self.reward_duration_end;
        let total_amount: u64;

        if current_time >= reward_duration_end {
            total_amount = funding_amount
        } else {
            let remaining_seconds = reward_duration_end.safe_sub(current_time)?;
            let leftover: u64 = safe_mul_shr_cast(
                self.reward_rate,
                remaining_seconds.into(),
                SCALE_OFFSET,
                Rounding::Down,
            )?;

            total_amount = leftover.safe_add(funding_amount)?;
        }

        self.reward_rate = safe_shl_div_cast(
            total_amount.into(),
            self.reward_duration.into(),
            SCALE_OFFSET,
            Rounding::Down,
        )?;
        self.last_update_time = current_time;
        self.reward_duration_end = current_time.safe_add(self.reward_duration)?;

        Ok(())
    }
}

impl LbPair {
    pub fn initialize(
        &mut self,
        bump: u8,
        active_id: i32,
        bin_step: u16,
        token_mint_x: Pubkey,
        token_mint_y: Pubkey,
        reserve_x: Pubkey,
        reserve_y: Pubkey,
        oracle: Pubkey,
        static_parameter: StaticParameters,
        pair_type: u8,
        pair_status: u8,
    ) -> Result<()> {
        self.parameters = static_parameter;
        self.active_id = active_id;
        self.bin_step = bin_step;
        self.token_x_mint = token_mint_x;
        self.token_y_mint = token_mint_y;
        self.reserve_x = reserve_x;
        self.reserve_y = reserve_y;
        self.fee_owner = crate::admin::ID;
        self.bump_seed = [bump];
        self.bin_step_seed = bin_step.to_le_bytes();
        self.oracle = oracle;
        self.pair_type = pair_type;
        self.status = pair_status;

        Ok(())
    }

    pub fn is_wallet_whitelisted(&self, wallet: Pubkey) -> bool {
        !wallet.eq(&Pubkey::default())
            && self
                .whitelisted_wallet
                .iter()
                .find(|&&w| w.eq(&wallet))
                .is_some()
    }

    pub fn update_whitelisted_wallet(&mut self, idx: usize, wallet: Pubkey) -> Result<()> {
        require!(idx < self.whitelisted_wallet.len(), LBError::InvalidIndex);
        self.whitelisted_wallet[idx] = wallet;

        Ok(())
    }

    pub fn add_whitelist_wallet(&mut self, wallet: Pubkey) -> Result<()> {
        let mut index = None;

        for (idx, whitelisted) in self.whitelisted_wallet.iter().enumerate() {
            if whitelisted.eq(&wallet) {
                return Ok(()); // Wallet already exists in the whitelist, returning early
            }
            if index.is_none() && whitelisted.eq(&Pubkey::default()) {
                index = Some(idx);
            }
        }

        match index {
            Some(idx) => {
                self.whitelisted_wallet[idx] = wallet;
                Ok(())
            }
            None => Err(LBError::ExceedMaxWhitelist.into()),
        }
    }

    pub fn is_permission_pair(&self) -> Result<bool> {
        let pair_type: PairType = self
            .pair_type
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?;

        Ok(pair_type.eq(&PairType::Permission))
    }

    pub fn is_enabled(&self) -> Result<bool> {
        let status: PairStatus = self
            .status
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?;

        Ok(status.eq(&PairStatus::Enabled))
    }

    pub fn is_deposit_allowed(&self, wallet: Pubkey) -> Result<bool> {
        if self.is_permission_pair()? {
            Ok(self.is_wallet_whitelisted(wallet) || self.is_enabled()?)
        } else {
            self.is_enabled()
        }
    }

    pub fn update_fee_parameters(&mut self, parameter: &FeeParameter) -> Result<()> {
        let current_timestamp = Clock::get()?.unix_timestamp;
        if self.last_updated_at > 0 {
            let second_elapsed = current_timestamp.safe_sub(self.last_updated_at)?;

            require!(
                second_elapsed > MAX_FEE_UPDATE_WINDOW,
                LBError::ExcessiveFeeUpdate
            );
        }

        self.parameters.update(parameter)?;
        self.last_updated_at = current_timestamp;

        Ok(())
    }

    pub fn seeds(&self) -> Result<Vec<&[u8]>> {
        let min_key = min(self.token_x_mint, self.token_y_mint);
        let (min_key_ref, max_key_ref) = if min_key == self.token_x_mint {
            (self.token_x_mint.as_ref(), self.token_y_mint.as_ref())
        } else {
            (self.token_y_mint.as_ref(), self.token_x_mint.as_ref())
        };
        if self.is_permission_pair()? {
            Ok(vec![
                PERMISSION,
                min_key_ref,
                max_key_ref,
                &self.bin_step_seed,
                &self.bump_seed,
            ])
        } else {
            Ok(vec![
                min_key_ref,
                max_key_ref,
                &self.bin_step_seed,
                &self.bump_seed,
            ])
        }
    }

    #[inline(always)]
    pub fn swap_for_y(&self, out_token_mint: Pubkey) -> bool {
        out_token_mint.eq(&self.token_y_mint)
    }

    /// Plus / Minus 1 to the active bin based on the swap direction
    pub fn advance_active_bin(&mut self, swap_for_y: bool) -> Result<()> {
        let next_active_bin_id = if swap_for_y {
            self.active_id.safe_sub(1)?
        } else {
            self.active_id.safe_add(1)?
        };

        require!(
            next_active_bin_id >= MIN_BIN_ID && next_active_bin_id <= MAX_BIN_ID,
            LBError::PairInsufficientLiquidity
        );

        self.active_id = next_active_bin_id;

        Ok(())
    }

    /// Base fee rate = Base fee factor * bin step. This is in 1e9 unit.
    pub fn get_base_fee(&self) -> Result<u128> {
        Ok(u128::from(self.parameters.base_factor)
            .safe_mul(self.bin_step.into())?
            // Make it to be the same as FEE_PRECISION defined for ceil_div later on.
            .safe_mul(10u128)?)
    }

    /// Variable fee rate = variable fee factor * (volatility_accumulator * bin_step)^2
    fn compute_variable_fee(&self, volatility_accumulator: u32) -> Result<u128> {
        if self.parameters.variable_fee_control > 0 {
            let volatility_accumulator: u128 = volatility_accumulator.into();
            let bin_step: u128 = self.bin_step.into();
            let variable_fee_control: u128 = self.parameters.variable_fee_control.into();

            let square_vfa_bin = volatility_accumulator
                .safe_mul(bin_step)?
                .checked_pow(2)
                .ok_or(LBError::MathOverflow)?;

            // Variable fee control, volatility accumulator, bin step are in basis point unit (10_000)
            // This is 1e20. Which > 1e9. Scale down it to 1e9 unit and ceiling the remaining.
            let v_fee = variable_fee_control.safe_mul(square_vfa_bin)?;

            let scaled_v_fee = v_fee.safe_add(99_999_999_999)?.safe_div(100_000_000_000)?;
            return Ok(scaled_v_fee);
        }

        Ok(0)
    }

    /// Variable fee rate = variable_fee_control * (variable_fee_accumulator * bin_step) ^ 2
    pub fn get_variable_fee(&self) -> Result<u128> {
        self.compute_variable_fee(self.v_parameters.volatility_accumulator)
    }

    /// Total fee rate = base_fee_rate + variable_fee_rate
    pub fn get_total_fee(&self) -> Result<u128> {
        let total_fee_rate = self.get_base_fee()?.safe_add(self.get_variable_fee()?)?;
        let total_fee_rate_cap = std::cmp::min(total_fee_rate, MAX_FEE_RATE.into());
        Ok(total_fee_rate_cap)
    }

    #[cfg(test)]
    /// Maximum fee rate
    fn get_max_total_fee(&self) -> Result<u128> {
        let max_total_fee_rate = self
            .get_base_fee()?
            .safe_add(self.compute_variable_fee(self.parameters.max_volatility_accumulator)?)?;

        let total_fee_rate_cap = std::cmp::min(max_total_fee_rate, MAX_FEE_RATE.into());
        Ok(total_fee_rate_cap)
    }

    /// Compute composition fee. Composition_fee = fee_amount * (1 + total fee rate)
    pub fn compute_composition_fee(&self, swap_amount: u64) -> Result<u64> {
        let total_fee_rate = self.get_total_fee()?;
        // total_fee_rate 1e9 unit
        let fee_amount = u128::from(swap_amount).safe_mul(total_fee_rate)?;
        let composition_fee =
            fee_amount.safe_mul(u128::from(FEE_PRECISION).safe_add(total_fee_rate)?)?;
        // 1e9 unit * 1e9 unit = 1e18, scale back
        let scaled_down_fee = composition_fee.safe_div(u128::from(FEE_PRECISION).pow(2))?;

        Ok(scaled_down_fee
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?)
    }

    /// Compute fee from amount, where fee is part of the amount. The result is ceil-ed.
    pub fn compute_fee_from_amount(&self, amount_with_fees: u64) -> Result<u64> {
        // total_fee_rate 1e9 unit
        let total_fee_rate = self.get_total_fee()?;
        // Ceil division
        let fee_amount = u128::from(amount_with_fees)
            .safe_mul(total_fee_rate)?
            .safe_add((FEE_PRECISION - 1).into())?;
        let scaled_down_fee = fee_amount.safe_div(FEE_PRECISION.into())?;

        Ok(scaled_down_fee
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?)
    }

    /// Compute fee for the amount. The fee is not part of the amount. This function is used when you do not know the amount_with_fees
    /// Solve for fee_amount, equation: (amount + fee_amount) * total_fee_rate / 1e9 = fee_amount
    /// fee_amount = (amount * total_fee_rate) / (1e9 - total_fee_rate)
    /// The result is ceil-ed.
    pub fn compute_fee(&self, amount: u64) -> Result<u64> {
        let total_fee_rate = self.get_total_fee()?;
        let denominator = u128::from(FEE_PRECISION).safe_sub(total_fee_rate)?;

        // Ceil division
        let fee = u128::from(amount)
            .safe_mul(total_fee_rate)?
            .safe_add(denominator)?
            .safe_sub(1)?;

        let scaled_down_fee = fee.safe_div(denominator)?;

        Ok(scaled_down_fee
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?)
    }

    /// Compute protocol fee
    pub fn compute_protocol_fee(&self, fee_amount: u64) -> Result<u64> {
        let protocol_fee = u128::from(fee_amount)
            .safe_mul(self.parameters.protocol_share.into())?
            .safe_div(BASIS_POINT_MAX as u128)?;

        Ok(protocol_fee
            .try_into()
            .map_err(|_| LBError::TypeCastFailed)?)
    }

    /// Accumulate protocol fee
    pub fn accumulate_protocol_fees(&mut self, fee_amount_x: u64, fee_amount_y: u64) -> Result<()> {
        self.protocol_fee.amount_x = self.protocol_fee.amount_x.safe_add(fee_amount_x)?;
        self.protocol_fee.amount_y = self.protocol_fee.amount_y.safe_add(fee_amount_y)?;

        Ok(())
    }

    /// Update volatility reference and accumulator
    pub fn update_volatility_parameters(&mut self, current_timestamp: i64) -> Result<()> {
        self.v_parameters.update_volatility_parameter(
            self.active_id,
            current_timestamp,
            &self.parameters,
        )
    }

    pub fn update_references(&mut self, current_timestamp: i64) -> Result<()> {
        self.v_parameters
            .update_references(self.active_id, current_timestamp, &self.parameters)
    }

    pub fn update_volatility_accumulator(&mut self) -> Result<()> {
        self.v_parameters
            .update_volatility_accumulator(self.active_id, &self.parameters)
    }

    pub fn withdraw_protocol_fee(&mut self, amount_x: u64, amount_y: u64) -> Result<()> {
        self.protocol_fee.amount_x = self.protocol_fee.amount_x.safe_sub(amount_x)?;
        self.protocol_fee.amount_y = self.protocol_fee.amount_y.safe_sub(amount_y)?;

        Ok(())
    }

    pub fn set_fee_owner(&mut self, fee_owner: Pubkey) {
        self.fee_owner = fee_owner;
    }

    pub fn oracle_initialized(&self) -> bool {
        self.oracle != Pubkey::default()
    }

    pub fn flip_bin_array_bit(
        &mut self,
        bin_array_bitmap_extension: &Option<AccountLoader<BinArrayBitmapExtension>>,
        bin_array_index: i32,
    ) -> Result<()> {
        if self.is_overflow_default_bin_array_bitmap(bin_array_index) {
            match bin_array_bitmap_extension {
                Some(bitmap_ext) => {
                    bitmap_ext.load_mut()?.flip_bin_array_bit(bin_array_index)?;
                }
                None => return Err(LBError::BitmapExtensionAccountIsNotProvided.into()),
            }
        } else {
            self.flip_bin_array_bit_internal(bin_array_index)?;
        }

        Ok(())
    }

    pub fn is_overflow_default_bin_array_bitmap(&self, bin_array_index: i32) -> bool {
        let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
        bin_array_index > max_bitmap_id || bin_array_index < min_bitmap_id
    }

    pub fn bitmap_range() -> (i32, i32) {
        (-BIN_ARRAY_BITMAP_SIZE, BIN_ARRAY_BITMAP_SIZE - 1)
    }

    fn get_bin_array_offset(bin_array_index: i32) -> usize {
        (bin_array_index + BIN_ARRAY_BITMAP_SIZE) as usize
    }

    fn flip_bin_array_bit_internal(&mut self, bin_array_index: i32) -> Result<()> {
        let bin_array_offset = Self::get_bin_array_offset(bin_array_index);
        let bin_array_bitmap = U1024::from_limbs(self.bin_array_bitmap);
        let mask = one::<1024, 16>() << bin_array_offset;
        self.bin_array_bitmap = bin_array_bitmap.bitxor(mask).into_limbs();
        Ok(())
    }

    // return bin_array_index that it's liquidity is non-zero
    // if cannot find one, return false
    pub fn next_bin_array_index_with_liquidity_internal(
        &self,
        swap_for_y: bool,
        start_array_index: i32,
    ) -> Result<(i32, bool)> {
        let bin_array_bitmap = U1024::from_limbs(self.bin_array_bitmap);
        let array_offset: usize = Self::get_bin_array_offset(start_array_index);
        let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
        if swap_for_y {
            let binmap_range: usize = max_bitmap_id
                .safe_sub(min_bitmap_id)?
                .try_into()
                .map_err(|_| LBError::TypeCastFailed)?;
            let offset_bit_map = bin_array_bitmap.shl(binmap_range.safe_sub(array_offset)?);

            if offset_bit_map.eq(&U1024::ZERO) {
                return Ok((min_bitmap_id.safe_sub(1)?, false));
            } else {
                let next_bit = offset_bit_map.leading_zeros();
                return Ok((start_array_index.safe_sub(next_bit as i32)?, true));
            }
        } else {
            let offset_bit_map = bin_array_bitmap.shr(array_offset);
            if offset_bit_map.eq(&U1024::ZERO) {
                return Ok((max_bitmap_id.safe_add(1)?, false));
            } else {
                let next_bit = offset_bit_map.trailing_zeros();
                return Ok((
                    start_array_index.checked_add(next_bit as i32).unwrap(),
                    true,
                ));
            };
        }
    }

    // shift active until non-zero liquidity bin_array_index
    fn shift_active_bin(&mut self, swap_for_y: bool, bin_array_index: i32) -> Result<()> {
        // update active id
        let (lower_bin_id, upper_bin_id) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array_index)?;

        if swap_for_y {
            self.active_id = upper_bin_id;
        } else {
            self.active_id = lower_bin_id;
        }
        Ok(())
    }

    fn next_bin_array_index_with_liquidity_from_extension(
        swap_for_y: bool,
        bin_array_index: i32,
        bin_array_bitmap_extension: &Option<AccountLoader<BinArrayBitmapExtension>>,
    ) -> Result<(i32, bool)> {
        match bin_array_bitmap_extension {
            Some(bitmap_ext) => {
                return Ok(bitmap_ext
                    .load()?
                    .next_bin_array_index_with_liquidity(swap_for_y, bin_array_index)?);
            }
            None => return Err(LBError::BitmapExtensionAccountIsNotProvided.into()),
        }
    }

    pub fn next_bin_array_index_from_internal_to_extension(
        &mut self,
        swap_for_y: bool,
        current_array_index: i32,
        start_array_index: i32,
        bin_array_bitmap_extension: &Option<AccountLoader<BinArrayBitmapExtension>>,
    ) -> Result<()> {
        let (bin_array_index, is_non_zero_liquidity_flag) =
            self.next_bin_array_index_with_liquidity_internal(swap_for_y, start_array_index)?;
        if is_non_zero_liquidity_flag {
            if current_array_index != bin_array_index {
                self.shift_active_bin(swap_for_y, bin_array_index)?;
            }
        } else {
            let (bin_array_index, _) = LbPair::next_bin_array_index_with_liquidity_from_extension(
                swap_for_y,
                bin_array_index,
                bin_array_bitmap_extension,
            )?;
            // no need to check for flag here, because if we cannot find the non-liquidity bin array id in the extension go from lb_pair state, then extension will return error
            if current_array_index != bin_array_index {
                self.shift_active_bin(swap_for_y, bin_array_index)?;
            }
        }
        Ok(())
    }

    pub fn next_bin_array_index_with_liquidity(
        &mut self,
        swap_for_y: bool,
        bin_array_bitmap_extension: &Option<AccountLoader<BinArrayBitmapExtension>>,
    ) -> Result<()> {
        let start_array_index = BinArray::bin_id_to_bin_array_index(self.active_id)?;

        if self.is_overflow_default_bin_array_bitmap(start_array_index) {
            let (bin_array_index, is_non_zero_liquidity_flag) =
                LbPair::next_bin_array_index_with_liquidity_from_extension(
                    swap_for_y,
                    start_array_index,
                    bin_array_bitmap_extension,
                )?;
            if is_non_zero_liquidity_flag {
                if start_array_index != bin_array_index {
                    self.shift_active_bin(swap_for_y, bin_array_index)?;
                }
            } else {
                self.next_bin_array_index_from_internal_to_extension(
                    swap_for_y,
                    start_array_index,
                    bin_array_index,
                    bin_array_bitmap_extension,
                )?;
            }
        } else {
            self.next_bin_array_index_from_internal_to_extension(
                swap_for_y,
                start_array_index,
                start_array_index,
                bin_array_bitmap_extension,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod lb_pair_test {
    use super::*;
    use crate::constants::{tests::get_preset, *};
    use num_traits::Pow;
    use proptest::proptest;

    fn create_lb_pair_max() -> LbPair {
        LbPair {
            parameters: StaticParameters {
                base_factor: u16::MAX,
                decay_period: u16::MAX,
                filter_period: u16::MAX,
                max_volatility_accumulator: U24_MAX,
                protocol_share: MAX_PROTOCOL_SHARE,
                reduction_factor: u16::MAX,
                variable_fee_control: U24_MAX,
                max_bin_id: i32::MAX,
                min_bin_id: i32::MIN,
                _padding: [0u8; 6],
            },
            bin_step: BASIS_POINT_MAX as u16,
            active_id: 0,
            bin_step_seed: [0u8; 2],
            bump_seed: [0u8; 1],
            protocol_fee: ProtocolFee::default(),
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            v_parameters: VariableParameters {
                index_reference: i32::MAX,
                last_update_timestamp: i64::MAX,
                volatility_accumulator: U24_MAX,
                volatility_reference: U24_MAX,
                ..VariableParameters::default()
            },
            fee_owner: Pubkey::default(),
            reward_infos: [RewardInfo::default(); NUM_REWARDS],
            ..LbPair::default()
        }
    }

    fn id_to_price(bin_step: u16, bin_id: i32, base_decimal: u8, quote_decimal: u8) -> f64 {
        let base = 1.0 + bin_step as f64 / BASIS_POINT_MAX as f64;
        let price_per_lamport = base.powi(bin_id);
        price_per_lamport * 10.pow(base_decimal) as f64 / 10.pow(quote_decimal) as f64
    }

    #[test]
    fn is_deposit_allowed() {
        let mut lb_pair = LbPair::default();
        lb_pair.pair_type = PairType::Permissionless.into();
        lb_pair.status = PairStatus::Disabled.into();

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();

        assert!(lb_pair.add_whitelist_wallet(wallet_1).is_ok());

        assert!(lb_pair.is_deposit_allowed(wallet_1).unwrap() == false);

        lb_pair.pair_type = PairType::Permission.into();
        assert!(lb_pair.is_deposit_allowed(wallet_1).unwrap());
        assert!(lb_pair.is_deposit_allowed(wallet_2).unwrap() == false);
        assert!(lb_pair.is_deposit_allowed(Pubkey::default()).unwrap() == false);
    }

    #[test]
    fn test_is_wallet_whitelisted() {
        let mut lb_pair = LbPair::default();

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();
        let wallet_3 = Pubkey::new_unique();
        let wallet_4 = Pubkey::new_unique();

        assert!(lb_pair.add_whitelist_wallet(wallet_1).is_ok());
        assert!(lb_pair.add_whitelist_wallet(wallet_2).is_ok());
        assert!(lb_pair.add_whitelist_wallet(wallet_3).is_ok());

        assert!(lb_pair.is_wallet_whitelisted(wallet_1));
        assert!(lb_pair.is_wallet_whitelisted(wallet_2));
        assert!(lb_pair.is_wallet_whitelisted(wallet_3));
        assert!(lb_pair.is_wallet_whitelisted(Pubkey::default()) == false);
        assert!(lb_pair.is_wallet_whitelisted(wallet_4) == false);
    }

    #[test]
    fn test_update_whitelist_wallet() {
        let mut lb_pair = LbPair::default();

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();
        let wallet_3 = Pubkey::new_unique();
        let wallet_4 = Pubkey::new_unique();

        assert!(lb_pair.add_whitelist_wallet(wallet_1).is_ok());
        assert!(lb_pair.add_whitelist_wallet(wallet_2).is_ok());
        assert!(lb_pair.add_whitelist_wallet(wallet_3).is_ok());

        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&wallet_2));
        assert!(lb_pair.whitelisted_wallet[2].eq(&wallet_3));

        lb_pair.update_whitelisted_wallet(1, Pubkey::default());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&Pubkey::default()));
        assert!(lb_pair.whitelisted_wallet[2].eq(&wallet_3));

        assert!(lb_pair
            .update_whitelisted_wallet(3, Pubkey::default())
            .is_err());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&Pubkey::default()));
        assert!(lb_pair.whitelisted_wallet[2].eq(&wallet_3));

        lb_pair.update_whitelisted_wallet(2, Pubkey::default());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&Pubkey::default()));
        assert!(lb_pair.whitelisted_wallet[2].eq(&Pubkey::default()));

        assert!(lb_pair.add_whitelist_wallet(wallet_3).is_ok());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&wallet_3));
        assert!(lb_pair.whitelisted_wallet[2].eq(&Pubkey::default()));
    }

    #[test]
    fn test_whitelist_wallet() {
        let mut lb_pair = LbPair::default();

        let empty_slot = lb_pair
            .whitelisted_wallet
            .iter()
            .filter(|&&p| p.eq(&Pubkey::default()))
            .count();

        // Duplicate pubkey will not error, but nothing will be added
        assert!(lb_pair.add_whitelist_wallet(Pubkey::default()).is_ok());

        assert_eq!(empty_slot, 3);

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();
        let wallet_3 = Pubkey::new_unique();
        let wallet_4 = Pubkey::new_unique();

        assert!(lb_pair.add_whitelist_wallet(wallet_1).is_ok());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&Pubkey::default()));
        assert!(lb_pair.whitelisted_wallet[2].eq(&Pubkey::default()));

        assert!(lb_pair.add_whitelist_wallet(wallet_2).is_ok());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&wallet_2));
        assert!(lb_pair.whitelisted_wallet[2].eq(&Pubkey::default()));

        assert!(lb_pair.add_whitelist_wallet(wallet_3).is_ok());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&wallet_2));
        assert!(lb_pair.whitelisted_wallet[2].eq(&wallet_3));

        assert!(lb_pair.add_whitelist_wallet(wallet_4).is_err());

        assert!(lb_pair.add_whitelist_wallet(wallet_2).is_ok());
        assert!(lb_pair.whitelisted_wallet[0].eq(&wallet_1));
        assert!(lb_pair.whitelisted_wallet[1].eq(&wallet_2));
        assert!(lb_pair.whitelisted_wallet[2].eq(&wallet_3));
    }

    #[test]
    fn test_num_enum() {
        let permissionless_pool_type = 0;
        let permission_pool_type = 1;
        let unknown_pool_type = 2;

        let converted_type: std::result::Result<PairType, _> = permission_pool_type.try_into();
        assert!(converted_type.is_ok());
        assert_eq!(converted_type.unwrap(), PairType::Permission);

        let converted_type: std::result::Result<PairType, _> = permissionless_pool_type.try_into();
        assert!(converted_type.is_ok());
        assert_eq!(converted_type.unwrap(), PairType::Permissionless);

        let converted_type: std::result::Result<PairType, _> = unknown_pool_type.try_into();
        assert!(converted_type.is_err());

        assert_eq!(Into::<u8>::into(PairType::Permission), permission_pool_type);
        assert_eq!(
            Into::<u8>::into(PairType::Permissionless),
            permissionless_pool_type
        );
    }

    #[test]
    fn test_get_total_fee_rate_cap() {
        let total_fee_rate = create_lb_pair_max().get_max_total_fee();
        assert!(total_fee_rate.is_ok());
        assert_eq!(total_fee_rate.unwrap(), MAX_FEE_RATE as u128);
    }

    #[test]
    fn test_get_base_rate_fits_u128() {
        let base_fee_rate = create_lb_pair_max().get_base_fee();
        assert!(base_fee_rate.is_ok())
    }

    #[test]
    fn test_get_variable_rate_fits_u128() {
        let variable_fee_rate = create_lb_pair_max().get_variable_fee();
        assert!(variable_fee_rate.is_ok())
    }

    #[test]
    fn test_get_total_fee_rate_fits_u128() {
        let total_fee_rate = create_lb_pair_max().get_max_total_fee();
        assert!(total_fee_rate.is_ok())
    }

    #[test]
    fn test_compute_fee_fits_u64() {
        let fee_amount = create_lb_pair_max().compute_fee(u64::MAX);
        assert!(fee_amount.is_ok());
    }

    #[test]
    fn test_compute_fee_from_amount_fits_u64() {
        let fee_amount = create_lb_pair_max().compute_fee_from_amount(u64::MAX);
        assert!(fee_amount.is_ok());
    }

    #[test]
    fn test_compute_composite_fee_amount_fits_u64() {
        let fee_amount = create_lb_pair_max().compute_composition_fee(u64::MAX);
        assert!(fee_amount.is_ok());
    }

    #[test]
    fn test_volatile_fee_rate() {
        let bin_step = 10;

        let lb_pair = LbPair {
            parameters: get_preset(bin_step).unwrap(),
            bin_step,
            active_id: 0,
            protocol_fee: ProtocolFee::default(),
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            v_parameters: VariableParameters {
                volatility_accumulator: 10000,
                ..VariableParameters::default()
            },
            fee_owner: Pubkey::default(),
            reward_infos: [RewardInfo::default(); NUM_REWARDS],
            ..LbPair::default()
        };

        let total_fee_rate = lb_pair.get_total_fee();
        assert!(total_fee_rate.is_ok());

        let expected_base_fee_rate =
            (lb_pair.parameters.base_factor as i32 / BASIS_POINT_MAX) as f64 * bin_step as f64
                / BASIS_POINT_MAX as f64;
        let expected_volatile_fee_rate = (lb_pair.parameters.variable_fee_control as f64
            / BASIS_POINT_MAX as f64)
            * (lb_pair.v_parameters.volatility_accumulator as f64 / BASIS_POINT_MAX as f64
                * bin_step as f64
                / BASIS_POINT_MAX as f64)
                .pow(2);
        let expected_total_fee_rate = expected_base_fee_rate + expected_volatile_fee_rate;
        let expected_total_fee_rate = (expected_total_fee_rate * FEE_PRECISION as f64) as u128;

        assert_eq!(expected_total_fee_rate, total_fee_rate.unwrap());
    }

    #[test]
    fn test_compute_fee_from_amount() {
        let swap_amount = u64::MAX;
        let bin_step = 10;

        let lb_pair = LbPair {
            parameters: get_preset(bin_step).unwrap(),
            bin_step,
            active_id: 0,
            bin_step_seed: [0u8; 2],
            bump_seed: [0u8; 1],
            protocol_fee: ProtocolFee::default(),
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            v_parameters: VariableParameters::default(),
            fee_owner: Pubkey::default(),
            reward_infos: [RewardInfo::default(); NUM_REWARDS],
            ..LbPair::default()
        };

        let total_fee_rate = lb_pair.get_total_fee();
        assert!(total_fee_rate.is_ok());

        let total_fee_rate = total_fee_rate.unwrap() as f64 / FEE_PRECISION as f64;
        let expected_fee = (swap_amount as f64 * total_fee_rate).ceil();

        let fee = lb_pair.compute_fee_from_amount(swap_amount).unwrap();
        assert_eq!(expected_fee as u64, fee);
    }

    #[test]
    fn test_compute_fee() {
        let swap_amount = u64::MAX;
        let bin_step = 10;

        let lb_pair = LbPair {
            parameters: get_preset(bin_step).unwrap(),
            bin_step,
            active_id: 0,
            bin_step_seed: [0u8; 2],
            bump_seed: [0u8; 1],
            protocol_fee: ProtocolFee::default(),
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            v_parameters: VariableParameters::default(),
            fee_owner: Pubkey::default(),
            reward_infos: [RewardInfo::default(); NUM_REWARDS],
            ..LbPair::default()
        };

        let total_fee_rate = lb_pair.get_total_fee();
        assert!(total_fee_rate.is_ok());

        let total_fee_rate = total_fee_rate.unwrap() as f64 / FEE_PRECISION as f64;
        let inverse_total_fee_rate = 1.0f64 - total_fee_rate;

        let expected_fee = (swap_amount as f64 * total_fee_rate / inverse_total_fee_rate).ceil();
        let fee = lb_pair.compute_fee(swap_amount).unwrap();

        // Precision loss from float, the +1 can be remove if we use smaller swap amount ...
        assert_eq!(expected_fee as u64 + 1, fee);
    }

    #[test]
    fn test_fee_charges() {
        let bin_step = 10;
        let lb_pair = LbPair {
            parameters: get_preset(bin_step).unwrap(),
            bin_step,
            active_id: 0,
            bin_step_seed: [0u8; 2],
            bump_seed: [0u8; 1],
            protocol_fee: ProtocolFee::default(),
            token_x_mint: Pubkey::default(),
            token_y_mint: Pubkey::default(),
            reserve_x: Pubkey::default(),
            reserve_y: Pubkey::default(),
            v_parameters: VariableParameters {
                volatility_accumulator: 625,
                volatility_reference: 625,
                index_reference: 0,
                last_update_timestamp: 0,
                ..VariableParameters::default()
            },
            fee_owner: Pubkey::default(),
            reward_infos: [RewardInfo::default(); NUM_REWARDS],
            ..LbPair::default()
        };

        let amount = 1_234_567;
        let fee = lb_pair.compute_fee(amount).unwrap();
        let amount_with_fees = amount + fee;
        let fee_amount = lb_pair.compute_fee_from_amount(amount_with_fees).unwrap();

        println!("{} {}", fee, fee_amount);
    }

    #[test]
    fn test_flip_bin_array_bit_internal() {
        let mut lb_pair = LbPair::default();
        let index = 0;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );
        let index = 0;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            false
        );
        let index = 1;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );
        let index = 2;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );

        // max range
        let index = BIN_ARRAY_BITMAP_SIZE - 1;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );

        // TODO add test overflow for BIN_ARRAY_BITMAP_SIZE
        // TODO add test overflow for -BIN_ARRAY_BITMAP_SIZE-1
        let index = -BIN_ARRAY_BITMAP_SIZE;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );
    }

    #[test]
    fn test_flip_all_bin_array_bit_internal() {
        let mut lb_pair = LbPair::default();
        for i in -BIN_ARRAY_BITMAP_SIZE..BIN_ARRAY_BITMAP_SIZE {
            lb_pair.flip_bin_array_bit_internal(i).unwrap();
            assert_eq!(
                U1024::from_limbs(lb_pair.bin_array_bitmap)
                    .bit(LbPair::get_bin_array_offset(i) as usize),
                true
            );
        }
        for i in -BIN_ARRAY_BITMAP_SIZE..BIN_ARRAY_BITMAP_SIZE {
            lb_pair.flip_bin_array_bit_internal(i).unwrap();
            assert_eq!(
                U1024::from_limbs(lb_pair.bin_array_bitmap)
                    .bit(LbPair::get_bin_array_offset(i) as usize),
                false
            );
        }
    }

    #[test]
    fn test_next_id_to_initialized_bin_array_in_default_range() {
        let mut lb_pair = LbPair::default();
        let (min_bin_id, max_bin_id) = LbPair::bitmap_range();
        let index = max_bin_id;
        // deposit liquidity
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );
        // swap for y
        lb_pair
            .next_bin_array_index_with_liquidity(false, &None)
            .unwrap();
        let bin_id = BinArray::bin_id_to_bin_array_index(lb_pair.active_id).unwrap();
        assert_eq!(index, bin_id);

        // withdraw liquidity
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            false
        );
        // swap for x
        let index = min_bin_id;
        lb_pair.flip_bin_array_bit_internal(index).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(index) as usize),
            true
        );
        lb_pair
            .next_bin_array_index_with_liquidity(true, &None)
            .unwrap();
        let bin_id = BinArray::bin_id_to_bin_array_index(lb_pair.active_id).unwrap();
        assert_eq!(index, bin_id);
    }

    #[test]
    fn test_next_id_to_initialized_bin_array_internal() {
        let lb_pair = LbPair::default();
        let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
        let (next_bin_array_id, ok) = lb_pair
            .next_bin_array_index_with_liquidity_internal(false, 0)
            .unwrap();
        assert_eq!(ok, false);
        assert_eq!(next_bin_array_id, max_bitmap_id + 1);

        let (next_bin_array_id, ok) = lb_pair
            .next_bin_array_index_with_liquidity_internal(true, 0)
            .unwrap();
        assert_eq!(ok, false);
        assert_eq!(next_bin_array_id, min_bitmap_id - 1);
    }

    #[test]
    fn test_next_id_from_non_zero_liquidity_bin_array() {
        let mut lb_pair = LbPair::default();
        let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
        for i in min_bitmap_id..=max_bitmap_id {
            lb_pair.flip_bin_array_bit_internal(i).unwrap();
            let (lower_id, upper_id) = BinArray::get_bin_array_lower_upper_bin_id(i).unwrap();
            for j in lower_id..=upper_id {
                lb_pair.active_id = j;
                lb_pair
                    .next_bin_array_index_with_liquidity(false, &None)
                    .unwrap();
                assert_eq!(lb_pair.active_id, j);

                lb_pair
                    .next_bin_array_index_with_liquidity(true, &None)
                    .unwrap();
                assert_eq!(lb_pair.active_id, j);
            }
        }
    }

    proptest! {
        #[test]
        fn test_compute_composition_fee(
            swap_amount in 1..=u32::MAX,
        ) {
            let bin_steps = [1, 2, 5, 10, 15, 20, 25, 50, 100];
            let active_id = 3333;

            for bin_step in bin_steps {
                let mut lb_pair = LbPair::default();

                let pair_type = PairType::Permissionless;

                lb_pair
                    .initialize(
                        0,
                        active_id,
                        bin_step,
                        Pubkey::default(),
                        Pubkey::default(),
                        Pubkey::default(),
                        Pubkey::default(),
                        Pubkey::default(),
                        get_preset(bin_step).unwrap(),
                        pair_type.into(),
                        pair_type.get_default_pair_status().into()
                    )
                    .unwrap();

                let fee_rate_f64 = lb_pair.get_base_fee().unwrap() as f64 / FEE_PRECISION as f64;
                let expected_composition_fee = (swap_amount as f64 * fee_rate_f64 * (1.0 + fee_rate_f64)) as u64;
                let composition_fee = lb_pair.compute_composition_fee(swap_amount.into());

                assert!(composition_fee.is_ok());
                assert!(expected_composition_fee == composition_fee.unwrap());
            }

        }
    }

    proptest! {
        #[test]
        fn test_next_bin_array_index_with_liquidity(
            swap_for_y in 0..=1,
            start_index in -512..511,
            flip_id in -512..511) {

                let mut lb_pair = LbPair::default();
        lb_pair.flip_bin_array_bit_internal(flip_id).unwrap();
        assert_eq!(
            U1024::from_limbs(lb_pair.bin_array_bitmap)
                .bit(LbPair::get_bin_array_offset(flip_id) as usize),
            true
        );

        let swap_for_y = if swap_for_y == 0 {
            false
        }else{
            true
        };

        let (next_bin_array_id, ok) = lb_pair
        .next_bin_array_index_with_liquidity_internal(swap_for_y, start_index)
        .unwrap();


        if swap_for_y {
            if start_index >= flip_id {
                assert_eq!(ok, true);
                assert_eq!(next_bin_array_id, flip_id);
            }else{
                assert_eq!(ok, false);
                assert_eq!(next_bin_array_id, -513);
            }
        }else{
            if start_index <= flip_id {
                assert_eq!(ok, true);
                assert_eq!(next_bin_array_id, flip_id);
            }else{
                assert_eq!(ok, false);
                assert_eq!(next_bin_array_id, 512);
            }
        }
        }
    }
}
