use crate::errors::LBError;
use crate::events::UpdatePositionOperator as UpdatePositionOperatorEvent;
use crate::state::dynamic_position::PositionV3;
use anchor_lang::prelude::*;
#[event_cpi]
#[derive(Accounts)]
pub struct UpdatePositionOperator<'info> {
    #[account(mut, has_one = owner)]
    pub position: AccountLoader<'info, PositionV3>,
    pub owner: Signer<'info>,
}

pub fn handle(ctx: Context<UpdatePositionOperator>, new_operator: Pubkey) -> Result<()> {
    Ok(())
}
