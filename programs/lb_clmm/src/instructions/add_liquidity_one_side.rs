use super::add_liquidity_by_weight::BinLiquidityDistributionByWeight;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::position::PositionV2;
use crate::state::{bin::BinArray, lb_pair::LbPair};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityOneSideParameter {
    /// Amount of X token or Y token to deposit
    pub amount: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ModifyLiquidityOneSide<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        has_one = owner
    )]
    pub position: AccountLoader<'info, PositionV2>,

    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(mut)]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub reserve: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

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
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    liquidity_parameter: &LiquidityOneSideParameter,
) -> Result<()> {
    Ok(())
}
