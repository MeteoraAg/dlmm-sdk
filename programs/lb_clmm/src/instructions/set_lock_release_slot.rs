use crate::assert_eq_launch_pool_admin;
use crate::errors::LBError;
use crate::events::UpdatePositionLockReleaseSlot;
use crate::state::dynamic_position::PositionV3;
use crate::state::LbPair;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(lock_release_slot: u64)]
pub struct SetLockReleaseSlot<'info> {
    #[account(
        mut,
        has_one = lb_pair
    )]
    pub position: AccountLoader<'info, PositionV3>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        constraint = assert_eq_launch_pool_admin(sender.key()) @ LBError::UnauthorizedAccess
    )]
    pub sender: Signer<'info>,
}

pub fn handle(ctx: Context<SetLockReleaseSlot>, lock_release_slot: u64) -> Result<()> {
    Ok(())
}

// fn validate_lock_release_lock(
//     current_slot: u64,
//     existing_lock_release_lock: u64,
//     new_lock_release_slot: u64,
// ) -> Result<()> {
//     // Can only extend lock release slot into the future
//     require!(
//         new_lock_release_slot > current_slot && new_lock_release_slot > existing_lock_release_lock,
//         LBError::InvalidLockReleaseSlot
//     );

//     Ok(())
// }

// fn validate_update_lock_release_slot_for_normal_position(
//     current_slot: u64,
//     lock_release_slot: u64,
//     position: &PositionV2,
//     sender: Pubkey,
// ) -> Result<()> {
//     // Normal position. Only position owner can update lock release slot
//     require!(sender.eq(&position.owner), LBError::UnauthorizedAccess);

//     validate_lock_release_lock(current_slot, position.lock_release_slot, lock_release_slot)?;

//     Ok(())
// }

// fn validate_update_lock_release_slot_for_seed_position(
//     current_slot: u64,
//     lock_release_slot: u64,
//     lb_pair: &LbPair,
//     position: &PositionV2,
//     sender: Pubkey,
// ) -> Result<()> {
//     if current_slot >= lb_pair.activation_slot {
//         // Treat it as normal position, therefore pool creator is not authorized to update, only position owner
//         require!(sender.eq(&position.owner), LBError::UnauthorizedAccess);

//         validate_lock_release_lock(current_slot, position.lock_release_slot, lock_release_slot)?;
//     } else {
//         // Seed position, only pool creator can update
//         require!(sender.eq(&lb_pair.creator), LBError::UnauthorizedAccess);

//         // No validation on lock_release_slot to allow pool creator to withdraw if there's any mistake in seeded liquidity
//     }

//     Ok(())
// }

// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[test]
//     fn validate_update_lock_release_slot_for_seed_position_after_activation() {
//         let position_owner = Pubkey::new_unique();
//         let pool_creator = Pubkey::new_unique();

//         let activation_slot = 100;
//         let current_slot = activation_slot + 1;
//         let lock_release_slot = activation_slot + 100;

//         let lb_pair = LbPair {
//             creator: pool_creator,
//             activation_slot,
//             ..Default::default()
//         };

//         let position = PositionV2 {
//             owner: position_owner,
//             subjected_to_bootstrap_liquidity_locking: true.into(),
//             lock_release_slot,
//             ..Default::default()
//         };

//         let new_lock_release_slot = lock_release_slot + 100;

//         // Sender is position owner
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             new_lock_release_slot,
//             &lb_pair,
//             &position,
//             position_owner
//         )
//         .is_ok());

//         // After activation, can only extend lock release slot
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             current_slot,
//             &lb_pair,
//             &position,
//             position_owner
//         )
//         .is_err());

//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             position.lock_release_slot - 10,
//             &lb_pair,
//             &position,
//             position_owner
//         )
//         .is_err());

//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             position.lock_release_slot,
//             &lb_pair,
//             &position,
//             position_owner
//         )
//         .is_err());

//         // Error because after activation, only position owner can do that.
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             new_lock_release_slot,
//             &lb_pair,
//             &position,
//             pool_creator,
//         )
//         .is_err());
//     }

//     #[test]
//     fn validate_update_lock_release_slot_for_seed_position_before_activation() {
//         let position_owner = Pubkey::new_unique();
//         let pool_creator = Pubkey::new_unique();

//         let current_slot = 50;
//         let activation_slot = current_slot + 50;
//         let lock_release_slot = activation_slot + 100;

//         let lb_pair = LbPair {
//             creator: pool_creator,
//             activation_slot,
//             ..Default::default()
//         };

//         let position = PositionV2 {
//             owner: position_owner,
//             subjected_to_bootstrap_liquidity_locking: true.into(),
//             lock_release_slot,
//             ..Default::default()
//         };

//         let new_lock_release_slot = lock_release_slot + 100;

//         // Sender is pool creator
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             new_lock_release_slot,
//             &lb_pair,
//             &position,
//             pool_creator
//         )
//         .is_ok());

//         // Before activation, allow any value for lock_release_slot
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             0,
//             &lb_pair,
//             &position,
//             pool_creator
//         )
//         .is_ok());

//         // Error because before activation, only pool creator can do that.
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             new_lock_release_slot,
//             &lb_pair,
//             &position,
//             position_owner,
//         )
//         .is_err());

//         // Error because before activation, only pool creator can do that.
//         assert!(validate_update_lock_release_slot_for_seed_position(
//             current_slot,
//             0,
//             &lb_pair,
//             &position,
//             position_owner,
//         )
//         .is_err());
//     }
// }
