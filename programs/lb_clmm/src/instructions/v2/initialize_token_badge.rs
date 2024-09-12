use crate::errors::LBError;
use crate::{assert_eq_admin, state::*};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use token_badge::TokenBadge;

#[derive(Accounts)]
pub struct InitializeTokenBadge<'info> {
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [
            b"token_badge",
            token_mint.key().as_ref(),
        ],
        bump,
        space = 8 + TokenBadge::INIT_SPACE
    )]
    pub token_badge: AccountLoader<'info, TokenBadge>,

    #[account(
        mut,
        constraint = assert_eq_admin(admin.key()) @ LBError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<InitializeTokenBadge>) -> Result<()> {
    Ok(())
}
