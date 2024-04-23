use crate::errors::LBError;
use crate::math::safe_math::SafeMath;
use crate::state::lb_pair::LbPair;
use crate::state::LaunchPadParams;
use anchor_lang::prelude::*;

// 1 slot ~500ms
const SLOT_PER_SECOND: u64 = 2;
const SLOT_PER_MINUTE: u64 = SLOT_PER_SECOND * 60;

#[cfg(feature = "localnet")]
const SLOT_BUFFER: u64 = 0;

#[cfg(not(feature = "localnet"))]
const SLOT_BUFFER: u64 = SLOT_PER_MINUTE * 60;

#[derive(Accounts)]
pub struct SetActivationSlot<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        constraint = lb_pair.load()?.creator.eq(&admin.key()) @ LBError::UnauthorizedAccess,
    )]
    pub admin: Signer<'info>,
}

pub fn handle(ctx: Context<SetActivationSlot>, new_activation_slot: u64) -> Result<()> {
    Ok(())
}
