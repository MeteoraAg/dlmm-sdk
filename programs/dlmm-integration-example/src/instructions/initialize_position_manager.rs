use anchor_lang::prelude::*;
use dlmm_program_interface::state::lb_pair::LbPair;
use crate::state::position_manager::PositionManager;

#[derive(Accounts)]
pub struct InitializePositionManager<'info> {
    #[account(
        init,
        seeds = 
            [
                b"position_manager",
                lb_pair.key().as_ref(),
                owner.key().as_ref()
            ],
        payer = owner,
        bump,
        space = 8 + PositionManager::INIT_SPACE
    )]
    pub user: AccountLoader<'info, PositionManager>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<InitializePositionManager>) -> Result<()> {
    let mut user = ctx.accounts.user.load_init()?;
    user.init(ctx.accounts.owner.key(), ctx.accounts.lb_pair.key(), *ctx.bumps.get("user").unwrap());

    Ok(())
}