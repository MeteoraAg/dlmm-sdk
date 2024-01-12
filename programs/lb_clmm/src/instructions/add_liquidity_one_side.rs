use crate::authorize_modify_position;
use crate::errors::LBError;
use crate::math::price_math::get_price_from_id;
use crate::math::safe_math::SafeMath;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::math::utils_math::{
    safe_mul_div_cast_from_u256_to_u64, safe_mul_div_cast_from_u64_to_u64,
};
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::position::PositionV2;
use crate::state::{bin::BinArray, lb_pair::LbPair};
use anchor_spl::token_2022::TransferChecked;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use anchor_lang::prelude::*;
use ruint::aliases::U256;

use super::add_liquidity_by_weight::BinLiquidityDistributionByWeight;

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

impl LiquidityOneSideParameter {
    // require bin id to be sorted before doing this
    pub fn to_amounts_into_bin<'a, 'info>(
        &'a self,
        active_id: i32,
        bin_step: u16,
        deposit_for_y: bool,
    ) -> Result<Vec<u64>> {
        if deposit_for_y {
            // get sum of weight
            let mut total_weight = 0u64;
            for dist in self.bin_liquidity_dist.iter() {
                // skip all ask side
                if dist.bin_id > active_id {
                    // break because bin_id is in ascending order
                    break;
                }
                total_weight = total_weight.safe_add(dist.weight.into())?;
            }
            if total_weight == 0 {
                return Err(LBError::InvalidInput.into());
            }
            let mut amounts = vec![];
            for dist in self.bin_liquidity_dist.iter() {
                // skip all ask side
                if dist.bin_id > active_id {
                    amounts.push(0);
                } else {
                    amounts.push(safe_mul_div_cast_from_u64_to_u64(
                        dist.weight.into(),
                        self.amount,
                        total_weight,
                    )?);
                }
            }
            Ok(amounts)
        } else {
            // get sum of weight
            let mut total_weight = U256::ZERO;
            let mut weight_per_prices = vec![U256::ZERO; self.bin_liquidity_dist.len()];
            for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                // skip all bid side
                if dist.bin_id < active_id {
                    continue;
                }
                let weight_per_price = U256::from(dist.weight)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(U256::from(get_price_from_id(dist.bin_id, bin_step)?))?;
                weight_per_prices[i] = weight_per_price;
                total_weight = total_weight.safe_add(weight_per_price)?;
            }

            if total_weight == U256::ZERO {
                return Err(LBError::InvalidInput.into());
            }

            let mut amounts = vec![];
            for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                // skip all bid side
                if dist.bin_id < active_id {
                    amounts.push(0);
                } else {
                    amounts.push(safe_mul_div_cast_from_u256_to_u64(
                        self.amount,
                        weight_per_prices[i],
                        total_weight,
                    )?);
                }
            }
            Ok(amounts)
        }
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct ModifyLiquidityOneSide<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, sender.key())?
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

    pub sender: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    liquidity_parameter: &LiquidityOneSideParameter,
) -> Result<()> {
    Ok(())
}
