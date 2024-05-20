use super::{LbPair, PairStatus};

use anchor_lang::prelude::*;
use solana_program::pubkey::Pubkey;

pub trait LbPairTypeActionAccess {
    fn validate_add_liquidity_access(&self, wallet: Pubkey) -> bool;
    fn validate_initialize_bin_array_access(&self, wallet: Pubkey) -> bool;
    fn validate_initialize_position_access(&self, wallet: Pubkey) -> bool;
    fn validate_swap_access(&self) -> bool;
    fn get_swap_cap_status_and_amount(&self, swap_for_y: bool) -> (bool, u64);
}

struct PermissionLbPairActionAccess<'a> {
    is_enabled: bool,
    activated: bool,
    throttled: bool,
    max_swapped_amount: u64,
    whitelisted_wallet: &'a [Pubkey],
}

impl<'a> PermissionLbPairActionAccess<'a> {
    pub fn new(lb_pair: &'a LbPair, current_slot: u64) -> Self {
        Self {
            whitelisted_wallet: &lb_pair.whitelisted_wallet,
            is_enabled: lb_pair.status == Into::<u8>::into(PairStatus::Enabled),
            activated: current_slot >= lb_pair.activation_slot,
            throttled: current_slot <= lb_pair.swap_cap_deactivate_slot,
            max_swapped_amount: lb_pair.max_swapped_amount,
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

    fn get_swap_cap_status_and_amount(&self, swap_for_y: bool) -> (bool, u64) {
        // no cap when user sell
        if swap_for_y {
            return (false, u64::MAX);
        }
        return (
            self.throttled && self.max_swapped_amount < u64::MAX,
            self.max_swapped_amount,
        );
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
    fn get_swap_cap_status_and_amount(&self, _swap_for_y: bool) -> (bool, u64) {
        (false, u64::MAX)
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

#[cfg(test)]
mod test {
    use super::*;
    use crate::state::{parameters::StaticParameters, PairType};
    fn create_lb_pair(is_permission: bool) -> LbPair {
        let mut lb_pair = LbPair::default();
        let pair_type = if is_permission {
            PairType::Permission
        } else {
            PairType::Permissionless
        };

        lb_pair
            .initialize(
                0,
                0,
                10,
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
                StaticParameters::default(),
                pair_type,
                PairStatus::Enabled.into(),
                Pubkey::default(),
                0,
                Pubkey::default(),
            )
            .unwrap();

        lb_pair
    }

    #[test]
    fn test_permission_pair_add_liquidity_access_validation() {
        let current_slot = 0;
        let mut lb_pair = create_lb_pair(true);

        assert_eq!(lb_pair.activation_slot, u64::MAX);
        assert_eq!(lb_pair.status, Into::<u8>::into(PairStatus::Enabled));

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();

        // Pair is enabled, activation slot not reached. No whitelisted wallet
        {
            // Access denied because wallet not whitelisted
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == false);
            assert!(access_validator.validate_add_liquidity_access(Pubkey::new_unique()) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == false);
        }

        lb_pair.add_whitelist_wallet(wallet_1).unwrap();
        lb_pair.add_whitelist_wallet(wallet_2).unwrap();

        // Pair is enabled, activation slot not reached. With whitelisted wallet.
        {
            // Access granted for only whitelisted wallet.
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == false);
            assert!(access_validator.validate_add_liquidity_access(Pubkey::new_unique()) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == true);
        }

        lb_pair.activation_slot = 0;

        // Pair is enabled, activation slot reached. Access granted for all wallet.
        {
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == true);
            assert!(access_validator.validate_add_liquidity_access(Pubkey::new_unique()) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == true);
        }

        lb_pair.status = PairStatus::Disabled.into();

        // Pair is disabled. Access denied.
        {
            // Access denied for all wallets.
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == false);
            assert!(access_validator.validate_add_liquidity_access(Pubkey::new_unique()) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == false);
        }
    }

    #[test]
    fn test_permissionless_pair_add_liquidity_access_validation() {
        let current_slot = 0;
        let mut lb_pair = create_lb_pair(false);

        assert_eq!(lb_pair.activation_slot, 0);
        assert_eq!(lb_pair.status, Into::<u8>::into(PairStatus::Enabled));

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();

        // Pair enabled. No whitelisted wallet.
        {
            // Access granted for all wallets.
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == true);
        }

        lb_pair.add_whitelist_wallet(wallet_1).unwrap();
        lb_pair.add_whitelist_wallet(wallet_2).unwrap();

        // Pair enabled with whitelisted wallet. Program endpoint do not allow admin to whitelist wallet in permissionless pair. But just in case, have a unit test.
        {
            // Access granted for all wallets.
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == true);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == true);
        }

        lb_pair.status = PairStatus::Disabled.into();

        // Pair disabled with whitelisted wallet.
        {
            // Access denied for all wallets.
            let access_validator =
                get_lb_pair_type_access_validator(&lb_pair, current_slot).unwrap();
            assert!(access_validator.validate_add_liquidity_access(Pubkey::default()) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_1) == false);
            assert!(access_validator.validate_add_liquidity_access(wallet_2) == false);
        }
    }

    #[test]
    fn test_is_wallet_in_whitelist() {
        let mut lb_pair = create_lb_pair(true);

        let wallet_1 = Pubkey::new_unique();
        let wallet_2 = Pubkey::new_unique();

        lb_pair.add_whitelist_wallet(wallet_1).unwrap();
        lb_pair.add_whitelist_wallet(wallet_2).unwrap();

        assert!(is_wallet_in_whitelist(&wallet_1, &lb_pair.whitelisted_wallet) == true);
        assert!(is_wallet_in_whitelist(&wallet_2, &lb_pair.whitelisted_wallet) == true);

        assert!(
            is_wallet_in_whitelist(&Pubkey::new_unique(), &lb_pair.whitelisted_wallet) == false
        );
    }
}
