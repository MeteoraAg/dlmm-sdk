use crate::constants::MAX_RESIZE_LENGTH;
use crate::errors::LBError;
use crate::events::DecreasePositionLength as DecreasePositionLengthEvent;
use crate::math::safe_math::SafeMath;
use crate::state::dynamic_position::DynamicPositionLoader;
use crate::state::dynamic_position::PositionV3;
use crate::state::dynamic_position::ResizeSide;
use anchor_lang::prelude::*;
#[event_cpi]
#[derive(Accounts)]
#[instruction(length_to_remove: u16, side: u8)]
pub struct DecreasePositionLength<'info> {
    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = owner,
    )]
    pub position: AccountLoader<'info, PositionV3>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// side: 0 lower side, and 1 upper side
pub fn handle(ctx: Context<DecreasePositionLength>, length_to_remove: u16, side: u8) -> Result<()> {
    Ok(())
}
