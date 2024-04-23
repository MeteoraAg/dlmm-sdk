use crate::events::{PositionClose, PositionCreate};
use crate::state::dynamic_position::{DynamicPositionLoader, PositionV3};
use crate::{
    manager::bin_array_manager::BinArrayManager,
    state::{bin::BinArray, lb_pair::LbPair, position::PositionV2},
};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct MigratePositionFromV2<'info> {
    #[account(
        init,
        payer = owner,
        space = PositionV3::space(position_v2.load()?.width()),
    )]
    pub position_v3: AccountLoader<'info, PositionV3>,

    // TODO do we need to check whether it is pda?
    #[account(
        mut,
        has_one = owner,
        has_one = lb_pair,
        close = rent_receiver
    )]
    pub position_v2: AccountLoader<'info, PositionV2>,

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

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle(ctx: Context<MigratePositionFromV2>) -> Result<()> {
    Ok(())
}
