use crate::assert_eq_admin;
use crate::errors::LBError;
use crate::state::lb_pair::LbPair;
use crate::state::lb_pair::PairStatus;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetPairStatus<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(constraint = assert_eq_admin(admin.key()) @ LBError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

pub fn handle(ctx: Context<SetPairStatus>, status: u8) -> Result<()> {
    Ok(())
}
