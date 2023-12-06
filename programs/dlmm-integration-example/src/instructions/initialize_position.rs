use crate::state::position_manager::PositionManager;
use anchor_lang::prelude::*;
use dlmm_program_interface::cpi::accounts::InitializePosition as DlmmInitializePosition;
use dlmm_program_interface::program::Dlmm;
use dlmm_program_interface::state::lb_pair::LbPair;
use dlmm_program_interface::state::position::Position;

#[derive(Accounts)]
pub struct InitializePosition<'info> {
    #[account(
        init,
        seeds = [b"position", position_manager.key().as_ref(), &position_manager.load().unwrap().idx.to_le_bytes()],
        payer = owner,
        bump,
        space = 8 + Position::INIT_SPACE,
    )]
    pub position: AccountLoader<'info, Position>,

    #[account(mut)]
    pub position_manager: AccountLoader<'info, PositionManager>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    /// CHECK: Event authority
    pub event_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub dlmm_program: Program<'info, Dlmm>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<InitializePosition>, lower_bin_id: i32, width: i32) -> Result<()> {
    let mut manager = ctx.accounts.position_manager.load_mut()?;

    manager.add_position(
        ctx.accounts.position.key(),
        lower_bin_id,
        lower_bin_id + width,
    )?;

    let seeds = [
        manager.lb_pair.as_ref(),
        manager.owner.as_ref(),
        &[manager.bump],
    ];

    let cpi_accounts = DlmmInitializePosition {
        lb_pair: ctx.accounts.lb_pair.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        owner: ctx.accounts.position_manager.to_account_info(),
        payer: ctx.accounts.owner.to_account_info(),
        position: ctx.accounts.position.to_account_info(),
        program: ctx.accounts.dlmm_program.to_account_info(),
        rent: ctx.accounts.rent.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };

    let signer_seeds = &[&seeds[..]];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.dlmm_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );

    dlmm_program_interface::cpi::initialize_position(cpi, lower_bin_id, width)?;

    Ok(())
}
