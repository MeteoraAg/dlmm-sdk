use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

declare_id!("EgU8zEJe77AZsDEzm9BLoXLpepsneh3JhdM1KxPNxBDs");

use instructions::add_liquidity::*;
use instructions::get_twap::*;
use instructions::initialize_position::*;
use instructions::initialize_position_manager::*;

#[program]
pub mod dlmm_integration_example {
    use super::*;

    pub fn initialize_position_manager(ctx: Context<InitializePositionManager>) -> Result<()> {
        instructions::initialize_position_manager::handle(ctx)
    }

    pub fn initialize_position(
        ctx: Context<InitializePosition>,
        lower_bin_id: i32,
        width: i32,
    ) -> Result<()> {
        instructions::initialize_position::handle(ctx, lower_bin_id, width)
    }

    pub fn add_liquidity_spot_distribution(
        ctx: Context<ModifyLiquidity>,
        amount_x: u64,
        amount_y: u64,
    ) -> Result<()> {
        instructions::add_liquidity::handle(ctx, amount_x, amount_y)
    }

    pub fn remove_liquidity(ctx: Context<ModifyLiquidity>, withdraw_percentage: u8) -> Result<()> {
        instructions::remove_liquidity::handle(ctx, withdraw_percentage)
    }

    pub fn get_twap(ctx: Context<GetTwap>, seconds_ago: i64) -> Result<f64> {
        instructions::get_twap::handle(ctx, seconds_ago)
    }
}
