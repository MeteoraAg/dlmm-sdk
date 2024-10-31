use crate::math::safe_math::SafeMath;
use crate::pair_action_access::ActivationType;
use crate::pair_action_access::LbPairTypeActionAccess;
use crate::state::lb_pair::{LbPair, PairStatus};
use crate::{
    constants::{SLOT_BUFFER, TIME_BUFFER},
    errors::LBError,
};
use anchor_lang::prelude::*;
use solana_program::pubkey::Pubkey;
pub struct PermissionLbPairActionAccess {
    is_enabled: bool,
    pre_activation_swap_address: Pubkey,
    activation_point: u64,
    current_point: u64,
    pre_activation_duration: u64,
    time_buffer: u64,
}

impl PermissionLbPairActionAccess {
    pub fn new(lb_pair: &LbPair) -> Result<Self> {
        let activation_type = ActivationType::try_from(lb_pair.activation_type)
            .map_err(|_| LBError::InvalidActivationType)?;
        let (current_point, time_buffer) = match activation_type {
            ActivationType::Slot => (Clock::get()?.slot, SLOT_BUFFER),
            ActivationType::Timestamp => (Clock::get()?.unix_timestamp as u64, TIME_BUFFER),
        };
        Ok(Self {
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
            pre_activation_swap_address: lb_pair.pre_activation_swap_address,
            activation_point: lb_pair.activation_point,
            current_point,
            pre_activation_duration: lb_pair.pre_activation_duration,
            time_buffer,
        })
    }
}

impl LbPairTypeActionAccess for PermissionLbPairActionAccess {
    fn validate_add_liquidity_access(&self) -> bool {
        self.is_enabled
    }

    fn validate_deposit_quote_token_in_active_bin(&self) -> bool {
        self.current_point >= self.activation_point
    }

    fn validate_remove_liquidity_access(&self, _is_ask_side: bool) -> Result<bool> {
        Ok(true)
    }

    fn validate_swap_access(&self, sender: Pubkey) -> bool {
        let activation_point = if self.pre_activation_swap_address.eq(&sender) {
            self.activation_point
                .saturating_sub(self.pre_activation_duration)
        } else {
            self.activation_point
        };

        self.is_enabled && self.current_point >= activation_point
    }
    fn get_current_point(&self) -> u64 {
        self.current_point
    }

    fn validate_set_pre_activation_duration(&self, new_pre_activation_duration: u64) -> Result<()> {
        // At least 1 hour buffer to prevent error, and vault cranked
        require!(
            new_pre_activation_duration >= self.time_buffer,
            LBError::InvalidInput
        );

        let new_pre_activation_start_point = self
            .activation_point
            .saturating_sub(new_pre_activation_duration);

        // Will not immediately enter pre-activation swap
        require!(
            new_pre_activation_start_point > self.current_point,
            LBError::InvalidInput
        );

        Ok(())
    }
    fn validate_update_new_activation_point(&self, new_activation_point: u64) -> Result<()> {
        // Activation point was set
        if self.activation_point != u64::MAX {
            // Make sure it's not yet activated
            require!(
                self.current_point < self.activation_point,
                LBError::AlreadyPassActivationPoint
            );
        }

        require!(
            new_activation_point > self.current_point,
            LBError::InvalidInput
        );

        let buffer_time = new_activation_point.safe_sub(self.current_point)?;
        require!(buffer_time > self.time_buffer, LBError::InvalidInput);

        if self.pre_activation_swap_address.ne(&Pubkey::default()) {
            let pre_activation_start_point = self
                .activation_point
                .saturating_sub(self.pre_activation_duration);

            // Don't allow update when the pool already enter pre-activation phase
            require!(
                self.current_point < pre_activation_start_point,
                LBError::InvalidInput
            );

            let new_pre_activation_start_point = new_activation_point.safe_sub(self.time_buffer)?;
            let buffered_new_pre_activation_start_point =
                new_pre_activation_start_point.safe_sub(self.time_buffer)?;

            // Prevent update of activation point causes the pool enter pre-activation phase immediately, no time buffer for any correction as the crank will swap it
            require!(
                self.current_point < buffered_new_pre_activation_start_point,
                LBError::InvalidInput
            );
        }

        Ok(())
    }

    fn validate_set_pre_activation_swap_address(&self) -> Result<()> {
        let pre_activation_start_point = self
            .activation_point
            .saturating_sub(self.pre_activation_duration);
        // Don't allow update when the pool already enter pre-activation phase
        require!(
            self.current_point < pre_activation_start_point,
            LBError::InvalidInput
        );
        Ok(())
    }

    fn validate_initialize_position_by_operator(&self) -> bool {
        true
    }
    fn validate_initialize_position(&self) -> bool {
        self.is_enabled
    }
    fn validate_initialize_bin_array(&self) -> bool {
        self.is_enabled
    }
}
