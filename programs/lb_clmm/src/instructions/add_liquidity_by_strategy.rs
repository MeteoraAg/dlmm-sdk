use crate::ModifyLiquidity;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct LiquidityParameterByStrategy {
    /// Amount of X token to deposit
    pub amount_x: u64,
    /// Amount of Y token to deposit
    pub amount_y: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// strategy parameters
    pub strategy_parameters: StrategyParameters,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct StrategyParameters {
    /// min bin id
    pub min_bin_id: i32,
    /// max bin id
    pub max_bin_id: i32,
    /// strategy type
    pub strategy_type: StrategyType,
    /// parameters
    pub parameteres: [u8; 64],
}

//// https://www.desmos.com/calculator/mru5p9e75u
#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct ParabolicParameter {
    /// amplification
    pub a_ask: i16,
    pub a_bid: i16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct SpotParameter {
    /// weight in ask side
    pub weight_ask: u16,
    /// weight in bid side
    pub weight_bid: u16,
    /// weight in active bin
    pub weight_active_bin: u16,
}

impl Default for StrategyParameters {
    fn default() -> Self {
        StrategyParameters {
            min_bin_id: 0,
            max_bin_id: 0,
            strategy_type: StrategyType::Spot,
            parameteres: [0; 64],
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub enum StrategyType {
    Spot,
    Curve,
    BidAsk,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    liquidity_parameter: &LiquidityParameterByStrategy,
) -> Result<()> {
    Ok(())
}
