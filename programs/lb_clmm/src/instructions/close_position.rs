use anchor_lang::prelude::*;

use crate::authorize_modify_position;
use crate::errors::LBError;
use crate::events::PositionClose;
use crate::state::dynamic_position::{DynamicPositionLoader, PositionV3};

#[event_cpi]
#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        constraint = authorize_modify_position(&position, sender.key())?,
        close = rent_receiver
    )]
    pub position: AccountLoader<'info, PositionV3>,

    pub sender: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle(ctx: Context<ClosePosition>) -> Result<()> {
    Ok(())
}
