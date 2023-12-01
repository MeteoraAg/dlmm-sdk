use crate::state::{bin::BinArray, lb_pair::LbPair, position::Position};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        has_one = owner,
        has_one = lb_pair,
        close = rent_receiver
    )]
    pub position: AccountLoader<'info, Position>,

    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array_lower: AccountLoader<'info, BinArray>,
    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array_upper: AccountLoader<'info, BinArray>,

    pub owner: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

#[allow(unused_variables)]
pub fn handle(ctx: Context<ClosePosition>) -> Result<()> {
    // No-op, an interface
    Ok(())
}
