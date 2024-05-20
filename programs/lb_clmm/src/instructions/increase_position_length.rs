use crate::constants::MAX_RESIZE_LENGTH;
use crate::constants::POSITION_MAX_LENGTH;
use crate::errors::LBError;
use crate::events::IncreasePositionLength as IncreasePositionLengthEvent;
use crate::math::safe_math::SafeMath;
use crate::state::dynamic_position::DynamicPositionLoader;
use crate::state::dynamic_position::PositionV3;
use crate::state::dynamic_position::ResizeSide;
use crate::state::LbPair;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(length_to_add: u16, side: u8)]
pub struct IncreasePositionLength<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = owner,
        has_one = lb_pair,
        realloc = PositionV3::new_space_after_add(length_to_add.into(), &position)?,
        realloc::payer = funder,
        realloc::zero = true,
    )]
    pub position: AccountLoader<'info, PositionV3>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// side: 0 lower side, and 1 upper side
pub fn handle(ctx: Context<IncreasePositionLength>, length_to_add: u16, side: u8) -> Result<()> {
    Ok(())
}
