use anchor_lang::prelude::*;

use crate::constants::DEFAULT_BIN_PER_POSITION;
use crate::state::dynamic_position::PositionV3;
use crate::{
    errors::LBError,
    events::PositionCreate,
    math::safe_math::SafeMath,
    state::{action_access::get_lb_pair_type_access_validator, lb_pair::LbPair},
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(lower_bin_id: i32, width: i32)]
pub struct InitializePosition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = PositionV3::space(width as usize),
    )]
    pub position: AccountLoader<'info, PositionV3>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<InitializePosition>, lower_bin_id: i32, width: i32) -> Result<()> {
    Ok(())
}

pub struct InitializePositionAccounts<'a, 'info> {
    pub lb_pair_account: &'a AccountLoader<'info, LbPair>,
    pub position_account: &'a AccountLoader<'info, PositionV3>,
}

pub fn handle_initialize_position<'a, 'info>(
    accounts: InitializePositionAccounts<'a, 'info>,
    lower_bin_id: i32,
    width: i32,
    owner: Pubkey,
    operator: Pubkey,
    creator: Pubkey,
    fee_owner: Pubkey,
) -> Result<()> {
    Ok(())
}
