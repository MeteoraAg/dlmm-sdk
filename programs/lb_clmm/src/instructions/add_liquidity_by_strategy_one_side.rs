use crate::instructions::add_liquidity_one_side;
use crate::ModifyLiquidityOneSide;
use anchor_lang::prelude::*;

use super::add_liquidity_by_strategy::StrategyParameters;
use super::add_liquidity_one_side::LiquidityOneSideParameter;

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

impl LiquidityParameterByStrategyOneSide {
    fn to_liquidity_parameter_by_weight(
        &self,
        active_id: i32,
    ) -> Result<LiquidityOneSideParameter> {
        Ok(LiquidityOneSideParameter {
            amount: self.amount,
            active_id: self.active_id,
            max_active_bin_slippage: self.max_active_bin_slippage,
            bin_liquidity_dist: self.strategy_parameters.to_weight_distribution(active_id)?,
        })
    }
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    liquidity_parameter: &LiquidityParameterByStrategyOneSide,
) -> Result<()> {
    let active_id = ctx.accounts.lb_pair.load()?.active_id;
    add_liquidity_one_side::handle(
        &ctx,
        &liquidity_parameter.to_liquidity_parameter_by_weight(active_id)?,
    )
}
