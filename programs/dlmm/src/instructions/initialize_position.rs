use anchor_lang::prelude::*;

use crate::state::{lb_pair::LbPair, position::Position};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Position::INIT_SPACE,
    )]
    pub position: AccountLoader<'info, Position>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[allow(unused_variables)]
pub fn handle(ctx: Context<InitializePosition>, lower_bin_id: i32, width: i32) -> Result<()> {
    // No-op, an interface
    Ok(())
}
