use crate::{
    state::{bin::BinArray, lb_pair::LbPair},
    utils::remaining_accounts_util::RemainingAccountsInfo,
};
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_interface::{Mint, TokenAccount},
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct FundReward<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub funder_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub funder: Signer<'info>,

    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array: AccountLoader<'info, BinArray>,

    pub token_program: Program<'info, Token>,
}

pub fn handle(
    ctx: Context<FundReward>,
    index: u64,
    amount: u64,
    carry_forward: bool,
    remaining_accounts_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}
