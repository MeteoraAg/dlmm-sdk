use crate::ModifyLiquidityOneSide;
use anchor_lang::prelude::*;

use super::add_liquidity_by_strategy::StrategyParameters;

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct LiquidityParameterByStrategyOneSide {
    /// Amount of X token or Y token to deposit
    pub amount: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// strategy parameters
    pub strategy_parameters: StrategyParameters,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    liquidity_parameter: &LiquidityParameterByStrategyOneSide,
) -> Result<()> {
    Ok(())
}
