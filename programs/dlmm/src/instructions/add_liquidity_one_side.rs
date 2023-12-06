use crate::state::{
    bin::BinArray, bin_array_bitmap_extension::BinArrayBitmapExtension, lb_pair::LbPair,
    position::Position,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct BinLiquidityDistributionOneSide {
    /// Define the bin ID wish to deposit to.
    pub bin_id: i32,
    /// weight of liquidity distributed for this bin id
    pub weight: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityOneSideParameter {
    /// Amount of X token to deposit
    pub amount: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistributionOneSide>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct ModifyLiquidityOneSide<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        has_one = owner
    )]
    pub position: AccountLoader<'info, Position>,

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

pub fn handle(
    ctx: Context<ModifyLiquidityOneSide>,
    liquidity_parameter: LiquidityOneSideParameter,
) -> Result<()> {
    Ok(())
}
