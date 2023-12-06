use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::add_liquidity::*;
use instructions::add_liquidity_by_weight::*;
use instructions::add_liquidity_one_side::*;
use instructions::claim_fee::*;
use instructions::claim_reward::*;
use instructions::close_position::*;
use instructions::increase_oracle_length::*;
use instructions::initialize_bin_array::*;
use instructions::initialize_bin_array_bitmap_extension::*;
use instructions::initialize_position::*;
use instructions::remove_liquidity::*;
use instructions::swap::*;

declare_id!("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

#[program]
pub mod dlmm {
    use super::*;

    pub fn initialize_bin_array_bitmap_extension(
        ctx: Context<InitializeBinArrayBitmapExtension>,
    ) -> Result<()> {
        instructions::initialize_bin_array_bitmap_extension::handle(ctx)
    }

    pub fn initialize_bin_array(ctx: Context<InitializeBinArray>, index: i64) -> Result<()> {
        instructions::initialize_bin_array::handle(ctx, index)
    }

    pub fn add_liquidity<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
        liquidity_parameter: LiquidityParameter,
    ) -> Result<()> {
        instructions::add_liquidity::handle(ctx, liquidity_parameter)
    }

    pub fn add_liquidity_by_weight<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
        liquidity_parameter: LiquidityParameterByWeight,
    ) -> Result<()> {
        instructions::add_liquidity_by_weight::handle(ctx, liquidity_parameter)
    }

    pub fn remove_liquidity<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
        bin_liquidity_removal: Vec<BinLiquidityReduction>,
    ) -> Result<()> {
        instructions::remove_liquidity::handle(ctx, bin_liquidity_removal)
    }

    pub fn initialize_position(
        ctx: Context<InitializePosition>,
        lower_bin_id: i32,
        width: i32,
    ) -> Result<()> {
        instructions::initialize_position::handle(ctx, lower_bin_id, width)
    }

    pub fn swap<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, Swap<'info>>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        instructions::swap::handle(ctx, amount_in, min_amount_out)
    }

    pub fn claim_reward(ctx: Context<ClaimReward>, reward_index: u64) -> Result<()> {
        instructions::claim_reward::handle(ctx, reward_index)
    }

    pub fn claim_fee(ctx: Context<ClaimFee>) -> Result<()> {
        instructions::claim_fee::handle(ctx)
    }

    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::close_position::handle(ctx)
    }

    pub fn increase_oracle_length(
        ctx: Context<IncreaseOracleLength>,
        length_to_add: u64,
    ) -> Result<()> {
        instructions::increase_oracle_length::handle(ctx, length_to_add)
    }

    pub fn add_liquidity_one_side(
        ctx: Context<ModifyLiquidityOneSide>,
        liquidity_parameter: LiquidityOneSideParameter,
    ) -> Result<()> {
        instructions::add_liquidity_one_side::handle(ctx, liquidity_parameter)
    }
}
