use crate::state::lb_pair::{LbPair, PairStatus};
use anchor_lang::prelude::*;
use solana_program::pubkey::Pubkey;

pub trait LbPairTypeActionAccess {
    fn validate_add_liquidity_access(&self, wallet: Pubkey) -> bool;
    fn validate_initialize_bin_array_access(&self, wallet: Pubkey) -> bool;
    fn validate_initialize_position_access(&self, wallet: Pubkey) -> bool;
    fn validate_swap_access(&self) -> bool;
}

struct PermissionLbPairActionAccess<'a> {
    is_enabled: bool,
    activated: bool,
    whitelisted_wallet: &'a [Pubkey],
}

impl<'a> PermissionLbPairActionAccess<'a> {
    pub fn new(lb_pair: &'a LbPair, current_slot: u64) -> Self {
        Self {
            whitelisted_wallet: &lb_pair.whitelisted_wallet,
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
            activated: current_slot >= lb_pair.activation_slot,
        }
    }
}

impl<'a> LbPairTypeActionAccess for PermissionLbPairActionAccess<'a> {
    fn validate_add_liquidity_access(&self, wallet: Pubkey) -> bool {
        // Pair disabled due to emergency mode. Nothing can be deposited.
        if !self.is_enabled {
            return false;
        }

        let is_wallet_whitelisted = is_wallet_in_whitelist(&wallet, &self.whitelisted_wallet);
        self.activated || is_wallet_whitelisted
    }

    fn validate_initialize_bin_array_access(&self, wallet: Pubkey) -> bool {
        self.validate_add_liquidity_access(wallet)
    }

    fn validate_initialize_position_access(&self, wallet: Pubkey) -> bool {
        self.validate_add_liquidity_access(wallet)
    }

    fn validate_swap_access(&self) -> bool {
        self.is_enabled && self.activated
    }
}

struct PermissionlessLbPairActionAccess {
    is_enabled: bool,
}

impl PermissionlessLbPairActionAccess {
    pub fn new(lb_pair: &LbPair) -> Self {
        Self {
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
        }
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

    fn validate_swap_access(&self) -> bool {
        self.is_enabled
    }
}

pub fn get_lb_pair_type_access_validator<'a>(
    lb_pair: &'a LbPair,
    current_slot: u64,
) -> Result<Box<dyn LbPairTypeActionAccess + 'a>> {
    if lb_pair.is_permission_pair()? {
        let permission_pair_access_validator =
            PermissionLbPairActionAccess::new(&lb_pair, current_slot);

        Ok(Box::new(permission_pair_access_validator))
    } else {
        let permissionless_pair_access_validator = PermissionlessLbPairActionAccess::new(&lb_pair);
        Ok(Box::new(permissionless_pair_access_validator))
    }
}

pub fn is_wallet_in_whitelist(wallet: &Pubkey, whitelist: &[Pubkey]) -> bool {
    !wallet.eq(&Pubkey::default()) && whitelist.iter().find(|&&w| w.eq(&wallet)).is_some()
}
