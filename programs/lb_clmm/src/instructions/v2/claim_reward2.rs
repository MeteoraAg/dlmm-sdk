use anchor_lang::prelude::*;
use anchor_spl::{
    memo::Memo,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    authorize_modify_position,
    state::{lb_pair::LbPair, position::PositionV2},
    utils::remaining_accounts_util::RemainingAccountsInfo,
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct ClaimReward2<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, PositionV2>,

    pub sender: Signer<'info>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,
}

pub fn handle(
    ctx: Context<ClaimReward2>,
    index: u64,
    min_bin_id: i32,
    max_bin_id: i32,
    remaining_accounts_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}
