use crate::errors::LBError;
use crate::math::safe_math::SafeMath;
use crate::pair_action_access::{
    CustomizablePermissionlessLbPairActionAccess, PermissionLbPairActionAccess,
    PermissionlessLbPairActionAccess,
};
use crate::state::lb_pair::LbPair;
use crate::state::lb_pair::PairType;
use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use solana_program::pubkey::Pubkey;
#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Type of the activation
pub enum ActivationType {
    Slot,
    Timestamp,
}

pub trait LbPairTypeActionAccess {
    fn validate_add_liquidity_access(&self) -> bool;
    // in customizable permissionless pool, we doesn't allow user to deposit quote token in active bin before activation_point (because they can't withdraw liquidity before activation_point or do internal swap)
    fn validate_deposit_quote_token_in_active_bin(&self) -> bool;
    fn validate_remove_liquidity_access(&self, is_ask_side: bool) -> Result<bool>;
    fn validate_swap_access(&self, sender: Pubkey) -> bool;
    fn get_current_point(&self) -> u64;
    fn validate_update_new_activation_point(&self, new_activation_point: u64) -> Result<()>;
    fn validate_set_pre_activation_duration(&self, new_pre_activation_duration: u64) -> Result<()>;
    fn validate_set_pre_activation_swap_address(&self) -> Result<()>;
    fn validate_initialize_position_by_operator(&self) -> bool;
    fn validate_initialize_position(&self) -> bool;
    fn validate_initialize_bin_array(&self) -> bool;
}

pub fn get_lb_pair_type_access_validator<'a>(
    lb_pair: &'a LbPair,
) -> Result<Box<dyn LbPairTypeActionAccess + 'a>> {
    let pair_type = PairType::try_from(lb_pair.pair_type).map_err(|_| LBError::InvalidPoolType)?;
    match pair_type {
        PairType::Permissionless => {
            let pair_access_validator = PermissionlessLbPairActionAccess::new(lb_pair)?;
            Ok(Box::new(pair_access_validator))
        }
        PairType::Permission => {
            let pair_access_validator = PermissionLbPairActionAccess::new(lb_pair)?;
            Ok(Box::new(pair_access_validator))
        }
        PairType::CustomizablePermissionless => {
            let pair_access_validator = CustomizablePermissionlessLbPairActionAccess::new(lb_pair)?;
            Ok(Box::new(pair_access_validator))
        }
    }
}

pub fn validate_activation_point(
    activation_point: u64,
    pre_activation_swap_duration: u64,
    deposit_close_idle_duration: u64,
    last_join_buffer: u64,
    current_point: u64,
) -> Result<()> {
    let pre_activation_swap_point = activation_point.safe_sub(pre_activation_swap_duration)?;
    let vault_last_join_point = pre_activation_swap_point.safe_sub(deposit_close_idle_duration)?;

    let pre_last_join_point = vault_last_join_point.safe_sub(last_join_buffer)?;

    // Don't allow pool creation if no one can join even with bundle
    require!(
        pre_last_join_point >= current_point,
        LBError::InvalidActivationDuration
    );
    Ok(())
}
