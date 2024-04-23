#[cfg(feature = "alpha-access")]
use super::validate_alpha_access;
use crate::errors::LBError;
use crate::events::PositionCreate;
use crate::handle_initialize_position;
use crate::state::action_access::get_lb_pair_type_access_validator;
use crate::state::dynamic_position::PositionV3;
use crate::state::lb_pair::LbPair;
use crate::utils::seeds;
use crate::InitializePositionAccounts;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(lower_bin_id: i32, width: i32)]
pub struct InitializePositionByOperator<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub base: Signer<'info>,
    #[account(
        init,
        seeds = [
            seeds::POSITION.as_ref(),
            lb_pair.key().as_ref(),
            base.key().as_ref(),
            lower_bin_id.to_le_bytes().as_ref(),
            width.to_le_bytes().as_ref(),
        ],
        bump,
        payer = payer,
        space = PositionV3::space(width as usize),
    )]
    pub position: AccountLoader<'info, PositionV3>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    /// operator
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,

    pub rent: Sysvar<'info, Rent>,
}

/// There is scenario that operator create and deposit position with non-valid owner
/// Then fund will be lost forever, so only whitelisted operators are able to perform this action
pub fn handle(
    ctx: Context<InitializePositionByOperator>,
    lower_bin_id: i32,
    width: i32,
    owner: Pubkey,
    fee_owner: Pubkey,
) -> Result<()> {
    Ok(())
}
