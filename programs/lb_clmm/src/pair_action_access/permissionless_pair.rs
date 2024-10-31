use crate::errors::LBError;
use crate::pair_action_access::ActivationType;
use crate::pair_action_access::LbPairTypeActionAccess;
use crate::state::lb_pair::{LbPair, PairStatus};
use anchor_lang::prelude::*;
pub struct PermissionlessLbPairActionAccess {
    is_enabled: bool,
    current_point: u64,
}

impl PermissionlessLbPairActionAccess {
    pub fn new(lb_pair: &LbPair) -> Result<Self> {
        let activation_type = ActivationType::try_from(lb_pair.activation_type)
            .map_err(|_| LBError::InvalidActivationType)?;
        let current_point = match activation_type {
            ActivationType::Slot => Clock::get()?.slot,
            ActivationType::Timestamp => Clock::get()?.unix_timestamp as u64,
        };
        Ok(Self {
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
            current_point,
        })
    }
}

impl LbPairTypeActionAccess for PermissionlessLbPairActionAccess {
    fn validate_add_liquidity_access(&self) -> bool {
        self.is_enabled
    }

    fn validate_deposit_quote_token_in_active_bin(&self) -> bool {
        true
    }

    fn validate_remove_liquidity_access(&self, _is_ask_side: bool) -> Result<bool> {
        Ok(true)
    }

    fn validate_swap_access(&self, _sender: Pubkey) -> bool {
        self.is_enabled
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
        false
    }
    fn validate_initialize_position(&self) -> bool {
        self.is_enabled
    }
    fn validate_initialize_bin_array(&self) -> bool {
        self.is_enabled
    }
}
