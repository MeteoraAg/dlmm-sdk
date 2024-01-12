use crate::state::position::PositionV2;
use anchor_lang::prelude::*;

pub fn authorize_modify_position<'info>(
    position: &AccountLoader<'info, PositionV2>,
    sender: Pubkey,
) -> Result<bool> {
    let position = position.load()?;
    return Ok(position.owner == sender || position.operator == sender);
}

pub trait PositionLiquidityFlowValidator {
    fn validate_outflow_to_ata_of_position_owner(&self, owner: Pubkey) -> Result<()>;
}
