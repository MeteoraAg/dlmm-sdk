use anchor_lang::prelude::*;
use anchor_spl::{
    memo::Memo,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    authorize_modify_position,
    state::{
        bin_array_bitmap_extension::BinArrayBitmapExtension, lb_pair::LbPair, position::PositionV2,
    },
    utils::remaining_accounts_util::RemainingAccountsInfo,
    LiquidityParameter,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ModifyLiquidity2<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, PositionV2>,

    #[account(
        mut,
        has_one = reserve_x,
        has_one = reserve_y,
        has_one = token_x_mint,
        has_one = token_y_mint,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(
        mut,
        token::mint = token_x_mint
    )]
    pub user_token_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = token_y_mint
    )]
    pub user_token_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,

    pub sender: Signer<'info>,
    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,

    pub memo_program: Program<'info, Memo>,
}

pub fn handle(
    ctx: Context<ModifyLiquidity2>,
    liquidity_parameter: LiquidityParameter,
    remaining_account_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}
