use crate::assert_eq_launch_pool_admin;
use crate::errors::LBError;
use crate::state::{lb_pair::LbPair, position::PositionV2};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct SetLockReleasePoint<'info> {
    #[account(
        mut,
        has_one = lb_pair
    )]
    pub position: AccountLoader<'info, PositionV2>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        constraint = assert_eq_launch_pool_admin(sender.key()) @ LBError::UnauthorizedAccess
    )]
    pub sender: Signer<'info>,
}

pub fn handle(ctx: Context<SetLockReleasePoint>, lock_release_point: u64) -> Result<()> {
    Ok(())
}
