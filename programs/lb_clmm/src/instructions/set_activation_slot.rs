use crate::assert_eq_admin;
use crate::errors::LBError;
use crate::state::lb_pair::LbPair;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetActivationSlot<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        constraint = assert_eq_admin(admin.key()) @ LBError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,
}

pub fn handle(ctx: Context<SetActivationSlot>, activation_slot: u64) -> Result<()> {
    Ok(())
}
