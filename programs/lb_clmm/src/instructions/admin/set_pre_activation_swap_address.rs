use crate::errors::LBError;
use anchor_lang::prelude::*;

use super::set_pre_activation_duration::SetPreActivationInfo;

pub fn handle(
    ctx: Context<SetPreActivationInfo>,
    pre_activation_swap_address: Pubkey,
) -> Result<()> {
    Ok(())
}
