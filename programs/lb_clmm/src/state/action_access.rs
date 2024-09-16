use crate::errors::LBError;
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::math::safe_math::SafeMath;
use anchor_lang::prelude::*;
use solana_program::pubkey::Pubkey;

use super::lb_pair::{LbPair, PairStatus};
// 1 slot ~500ms
const SLOT_PER_SECOND: u64 = 2;
const SLOT_PER_MINUTE: u64 = SLOT_PER_SECOND * 60;

#[cfg(feature = "localnet")]
const SLOT_BUFFER: u64 = 0;

#[cfg(not(feature = "localnet"))]
const SLOT_BUFFER: u64 = SLOT_PER_MINUTE * 60;

#[cfg(feature = "localnet")]
const TIME_BUFFER: u64 = 0;

#[cfg(not(feature = "localnet"))]
const TIME_BUFFER: u64 = 3600;

#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Type of the activation
pub enum ActivationType {
    Slot,
    Timestamp,
}

pub trait LbPairTypeActionAccess {
    fn validate_add_liquidity_access(&self, wallet: Pubkey) -> bool;
    fn validate_initialize_bin_array_access(&self, wallet: Pubkey) -> bool;
    fn validate_initialize_position_access(&self, wallet: Pubkey) -> bool;
    fn validate_swap_access(&self, sender: Pubkey) -> bool;
    fn subjected_to_initial_liquidity_locking(&self) -> bool;
    fn get_release_point(&self) -> u64;
    fn get_current_point(&self) -> u64;
    fn validate_update_new_activation_point(&self, new_activation_point: u64) -> Result<()>;
}

struct PermissionLbPairActionAccess {
    is_enabled: bool,
    whitelisted_wallet: Pubkey,
    pre_activation_swap_address: Pubkey,
    activation_point: u64,
    current_point: u64,
    lock_duration: u64,
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
            whitelisted_wallet: lb_pair.whitelisted_wallet,
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
            pre_activation_swap_address: lb_pair.pre_activation_swap_address,
            activation_point: lb_pair.activation_point,
            current_point,
            lock_duration: lb_pair.lock_duration,
            pre_activation_duration: lb_pair.pre_activation_duration,
            time_buffer,
        })
    }
}

impl LbPairTypeActionAccess for PermissionLbPairActionAccess {
    fn validate_add_liquidity_access(&self, wallet: Pubkey) -> bool {
        // Pair disabled due to emergency mode. Nothing can be deposited.
        if !self.is_enabled {
            return false;
        }

        if self.current_point >= self.activation_point {
            return true;
        }
        !self.whitelisted_wallet.eq(&Pubkey::default()) && self.whitelisted_wallet.eq(&wallet)
    }

    fn validate_initialize_bin_array_access(&self, wallet: Pubkey) -> bool {
        self.validate_add_liquidity_access(wallet)
    }

    fn validate_initialize_position_access(&self, wallet: Pubkey) -> bool {
        self.validate_add_liquidity_access(wallet)
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
    fn subjected_to_initial_liquidity_locking(&self) -> bool {
        self.current_point < self.activation_point
    }

    fn get_release_point(&self) -> u64 {
        if self.lock_duration > 0 && self.current_point < self.activation_point {
            self.activation_point.saturating_add(self.lock_duration)
        } else {
            0
        }
    }
    fn get_current_point(&self) -> u64 {
        self.current_point
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
        require!(buffer_time >= self.time_buffer, LBError::InvalidInput);
        Ok(())
    }
}

struct PermissionlessLbPairActionAccess {
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
    fn validate_add_liquidity_access(&self, _wallet: Pubkey) -> bool {
        self.is_enabled
    }

    fn validate_initialize_bin_array_access(&self, _wallet: Pubkey) -> bool {
        self.is_enabled
    }

    fn validate_initialize_position_access(&self, _wallet: Pubkey) -> bool {
        self.is_enabled
    }

    fn validate_swap_access(&self, _sender: Pubkey) -> bool {
        self.is_enabled
    }

    fn subjected_to_initial_liquidity_locking(&self) -> bool {
        false
    }

    fn get_release_point(&self) -> u64 {
        0
    }
    fn get_current_point(&self) -> u64 {
        self.current_point
    }
    fn validate_update_new_activation_point(&self, _new_activation_point: u64) -> Result<()> {
        Err(LBError::InvalidPoolType.into())
    }
}

pub fn get_lb_pair_type_access_validator<'a>(
    lb_pair: &'a LbPair,
) -> Result<Box<dyn LbPairTypeActionAccess + 'a>> {
    if lb_pair.is_permission_pair()? {
        let permission_pair_access_validator = PermissionLbPairActionAccess::new(lb_pair)?;
        Ok(Box::new(permission_pair_access_validator))
    } else {
        let permissionless_pair_access_validator = PermissionlessLbPairActionAccess::new(lb_pair)?;
        Ok(Box::new(permissionless_pair_access_validator))
    }
}
