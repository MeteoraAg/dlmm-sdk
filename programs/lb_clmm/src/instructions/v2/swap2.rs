use anchor_lang::prelude::*;
use anchor_spl::{
    memo::Memo,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    errors::LBError,
    state::{bin_array_bitmap_extension::BinArrayBitmapExtension, lb_pair::LbPair, oracle::Oracle},
    utils::remaining_accounts_util::RemainingAccountsInfo,
};

#[event_cpi]
#[derive(Accounts)]
pub struct Swap2<'info> {
    #[account(
        mut,
        has_one = reserve_x,
        has_one = reserve_y,
        has_one = token_x_mint,
        has_one = token_y_mint,
        has_one = oracle,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        has_one = lb_pair,
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(mut)]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_token_in.mint != user_token_out.mint @ LBError::InvalidTokenMint,
        constraint = user_token_in.mint == token_x_mint.key() || user_token_in.mint == token_y_mint.key() @ LBError::InvalidTokenMint,
    )]
    pub user_token_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = user_token_out.mint == token_x_mint.key() || user_token_out.mint == token_y_mint.key() @ LBError::InvalidTokenMint,
    )]
    pub user_token_out: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(mut)]
    pub host_fee_in: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    pub user: Signer<'info>,
    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,
}

pub fn handle_exact_in2(
    ctx: Context<Swap2>,
    amount_in: u64,
    min_amount_out: u64,
    remaining_account_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}

pub fn handle_exact_in_with_price_impact2(
    ctx: Context<Swap2>,
    amount_in: u64,
    active_id: Option<i32>,
    max_price_impact_bps: u16,
    remaining_account_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}
