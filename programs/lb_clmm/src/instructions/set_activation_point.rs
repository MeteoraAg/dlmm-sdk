use crate::assert_eq_admin;
use crate::errors::LBError;
use crate::state::lb_pair::LbPair;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetActivationPoint<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        constraint = lb_pair.load()?.creator.eq(&admin.key()) @ LBError::UnauthorizedAccess,
    )]
    pub admin: Signer<'info>,
}

pub fn handle(ctx: Context<SetActivationPoint>, activation_point: u64) -> Result<()> {
    Ok(())
}
