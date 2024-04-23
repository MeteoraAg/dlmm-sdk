use super::add_liquidity_by_strategy::StrategyParameters;
use crate::errors::LBError;
use crate::math::weight_to_amounts::to_amount_ask_side;
use crate::math::weight_to_amounts::to_amount_bid_side;
use crate::math::weight_to_amounts::AmountInBinSingleSide;
use crate::to_weight_ascending_order;
use crate::to_weight_descending_order;
use crate::to_weight_spot_balanced;
use crate::validate_add_liquidity_by_strategy_params;
use crate::StrategyType;
use crate::{handle_deposit_by_amounts_one_side, ModifyLiquidityOneSide};
use anchor_lang::prelude::*;

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
    pub fn to_amounts_into_bin(
        &self,
        active_id: i32,
        bin_step: u16,
        deposit_for_y: bool,
    ) -> Result<Vec<AmountInBinSingleSide>> {
        let min_bin_id = self.strategy_parameters.min_bin_id;
        let max_bin_id = self.strategy_parameters.max_bin_id;

        let weights = match self.strategy_parameters.strategy_type {
            StrategyType::SpotOneSide => Some(to_weight_spot_balanced(
                self.strategy_parameters.min_bin_id,
                self.strategy_parameters.max_bin_id,
            )),
            StrategyType::CurveOneSide => {
                if deposit_for_y {
                    Some(to_weight_ascending_order(min_bin_id, max_bin_id))
                } else {
                    Some(to_weight_descending_order(min_bin_id, max_bin_id))
                }
            }
            StrategyType::BidAskOneSide => {
                if deposit_for_y {
                    Some(to_weight_descending_order(min_bin_id, max_bin_id))
                } else {
                    Some(to_weight_ascending_order(min_bin_id, max_bin_id))
                }
            }
            _ => None,
        }
        .ok_or(LBError::InvalidStrategyParameters)?;

        if deposit_for_y {
            to_amount_bid_side(active_id, self.amount, &weights)
        } else {
            to_amount_ask_side(active_id, self.amount, bin_step, &weights)
        }
    }
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    liquidity_parameter: &LiquidityParameterByStrategyOneSide,
) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod add_liquidity_by_strategy_one_side {
    use super::*;

    fn new_add_liquidity_by_strategy_one_side_parameter(
        amount: u64,
        active_id: i32,
        min_bin_id: i32,
        max_bin_id: i32,
        strategy_type: StrategyType,
    ) -> LiquidityParameterByStrategyOneSide {
        LiquidityParameterByStrategyOneSide {
            amount,
            active_id,
            max_active_bin_slippage: i32::MAX,
            strategy_parameters: StrategyParameters {
                max_bin_id,
                min_bin_id,
                strategy_type,
                parameteres: [0u8; 64],
            },
        }
    }
    #[test]
    fn test_add_liquidity_by_strategy_ask_side() {
        let active_id = 100;
        let bin_step = 10;
        let deposit_for_y = false;
        let amount = 10000;
        let min_bin_id = 100;
        let max_bin_id = 200;
        {
            let parameters = new_add_liquidity_by_strategy_one_side_parameter(
                amount,
                active_id,
                min_bin_id,
                max_bin_id,
                StrategyType::SpotOneSide,
            );
            let amounts_in_bin = parameters
                .to_amounts_into_bin(active_id, bin_step, deposit_for_y)
                .unwrap();
            println!("spot one ask side {:?}", amounts_in_bin);
        }

        {
            let parameters = new_add_liquidity_by_strategy_one_side_parameter(
                amount,
                active_id,
                min_bin_id,
                max_bin_id,
                StrategyType::CurveOneSide,
            );
            let amounts_in_bin = parameters
                .to_amounts_into_bin(active_id, bin_step, deposit_for_y)
                .unwrap();
            println!("currve one ask side {:?}", amounts_in_bin);
        }

        {
            let parameters = new_add_liquidity_by_strategy_one_side_parameter(
                amount,
                active_id,
                min_bin_id,
                max_bin_id,
                StrategyType::BidAskOneSide,
            );
            let amounts_in_bin = parameters
                .to_amounts_into_bin(active_id, bin_step, deposit_for_y)
                .unwrap();
            println!("bid/ask one ask side {:?}", amounts_in_bin);
        }
    }

    #[test]
    fn test_add_liquidity_by_strategy_bid_side() {
        let active_id = 100;
        let bin_step = 10;
        let deposit_for_y = true;
        let amount = 10000;
        let min_bin_id = 0;
        let max_bin_id = 100;
        {
            let parameters = new_add_liquidity_by_strategy_one_side_parameter(
                amount,
                active_id,
                min_bin_id,
                max_bin_id,
                StrategyType::SpotOneSide,
            );

            let amounts_in_bin = parameters
                .to_amounts_into_bin(active_id, bin_step, deposit_for_y)
                .unwrap();

            println!("spot one bid side {:?}", amounts_in_bin);
        }

        {
            let parameters = new_add_liquidity_by_strategy_one_side_parameter(
                amount,
                active_id,
                min_bin_id,
                max_bin_id,
                StrategyType::CurveOneSide,
            );

            let amounts_in_bin = parameters
                .to_amounts_into_bin(active_id, bin_step, deposit_for_y)
                .unwrap();

            println!("curve one bid side{:?}", amounts_in_bin);
        }

        {
            let parameters = new_add_liquidity_by_strategy_one_side_parameter(
                amount,
                active_id,
                min_bin_id,
                max_bin_id,
                StrategyType::BidAskOneSide,
            );

            let amounts_in_bin = parameters
                .to_amounts_into_bin(active_id, bin_step, deposit_for_y)
                .unwrap();

            println!("bid/ask one bid side{:?}", amounts_in_bin);
        }
    }
}
