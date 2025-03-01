use crate::{errors::LBError, state::lb_pair::LbPair};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdatePairStatusPermissionless<'info> {
    #[account(
        mut,
        has_one = creator @ LBError::UnauthorizedAccess
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    pub creator: Signer<'info>,
}

pub fn handle(ctx: Context<UpdatePairStatusPermissionless>, status: u8) -> Result<()> {
    Ok(())
}
