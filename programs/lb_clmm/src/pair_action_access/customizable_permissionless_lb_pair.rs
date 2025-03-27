use crate::pair_action_access::ActivationType;
use crate::pair_action_access::LbPairTypeActionAccess;
use crate::state::lb_pair::{LbPair, PairStatus};
use crate::{
    constants::{SLOT_BUFFER, TIME_BUFFER},
    errors::LBError,
};
use anchor_lang::prelude::*;
use solana_program::pubkey::Pubkey;
pub struct CustomizablePermissionlessLbPairActionAccess {
    is_enabled: bool,
    pre_activation_swap_address: Pubkey,
    activation_point: u64,
    current_point: u64,
    pre_activation_duration: u64,
}

impl CustomizablePermissionlessLbPairActionAccess {
    pub fn new(lb_pair: &LbPair) -> Result<Self> {
        let activation_type = ActivationType::try_from(lb_pair.activation_type)
            .map_err(|_| LBError::InvalidActivationType)?;
        let (current_point, _) = match activation_type {
            ActivationType::Slot => (Clock::get()?.slot, SLOT_BUFFER),
            ActivationType::Timestamp => (Clock::get()?.unix_timestamp as u64, TIME_BUFFER),
        };
        Ok(Self {
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
            pre_activation_swap_address: lb_pair.pre_activation_swap_address,
            activation_point: lb_pair.activation_point,
            current_point,
            pre_activation_duration: lb_pair.pre_activation_duration,
        })
    }
}

impl LbPairTypeActionAccess for CustomizablePermissionlessLbPairActionAccess {
    fn validate_add_liquidity_access(&self) -> bool {
        self.is_enabled
    }

    fn validate_deposit_quote_token_in_active_bin(&self) -> bool {
        self.current_point >= self.activation_point
    }

    fn validate_remove_liquidity_access(&self, is_ask_side: bool) -> Result<bool> {
        if is_ask_side {
            // ask side can withdraw after 1 slot
            Ok(self.current_point > self.activation_point)
        } else {
            Ok(true)
        }
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
    fn validate_set_pre_activation_duration(
        &self,
        _new_pre_activation_duration: u64,
    ) -> Result<()> {
        Err(LBError::UnauthorizedAccess.into())
    }
    fn validate_update_new_activation_point(&self, _new_activation_point: u64) -> Result<()> {
        Err(LBError::UnauthorizedAccess.into())
    }
    fn validate_set_pre_activation_swap_address(&self) -> Result<()> {
        Err(LBError::UnauthorizedAccess.into())
    }

    fn validate_initialize_position_by_operator(&self) -> bool {
        self.current_point < self.activation_point
    }
    fn validate_initialize_position(&self) -> bool {
        self.is_enabled
    }
    fn validate_initialize_bin_array(&self) -> bool {
        self.is_enabled
    }
}
