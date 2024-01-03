use crate::state::{bin::BinArray, lb_pair::LbPair, position::PositionV2};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
        has_one = owner
    )]
    pub position: AccountLoader<'info, PositionV2>,

    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array_lower: AccountLoader<'info, BinArray>,
    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array_upper: AccountLoader<'info, BinArray>,

    pub owner: Signer<'info>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle(ctx: Context<ClaimReward>, index: u64) -> Result<()> {
    Ok(())
}
