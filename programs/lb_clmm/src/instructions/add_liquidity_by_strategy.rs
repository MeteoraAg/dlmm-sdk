use crate::errors::LBError;
use crate::instructions::add_liquidity_by_weight;
use crate::math::safe_math::SafeMath;
use crate::{BinLiquidityDistributionByWeight, LiquidityParameterByWeight, ModifyLiquidity};
use anchor_lang::prelude::*;

const PRECISION: i32 = 15000; // ~ i16 / 2
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

impl LiquidityParameterByStrategy {
    pub fn to_liquidity_parameter_by_weight(&self) -> Result<LiquidityParameterByWeight> {
        Ok(LiquidityParameterByWeight {
            amount_x: self.amount_x,
            amount_y: self.amount_y,
            active_id: self.active_id,
            max_active_bin_slippage: self.max_active_bin_slippage,
            bin_liquidity_dist: self.strategy_parameters.to_weight_distribution()?, // TODO: should we use  lb_pair.active_id?
        })
    }
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
    /// amplification in right side, from center_bin_id to max_bin_id
    pub a_right: i16,
    /// amplification in left side, from min_bin_id to center_bin_id
    pub a_left: i16,
    /// center bin id
    pub center_bin_id: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct SpotParameter {
    /// weight in right side, from center_bin_id to max_bin_id
    pub weight_right: u16,
    /// weight in left side, from min_bin_id to center_bin_id
    pub weight_left: u16,
    /// center bin id
    pub center_bin_id: i32,
}

fn calculate_curve_weight(amp: i16, b_max: i32, b_delta: i32) -> Result<u16> {
    let b = b_max.safe_sub(b_delta)?;
    let weight = (amp as i32).safe_mul(b)?.safe_div(PRECISION)?;
    Ok(u16::try_from(weight).map_err(|_| LBError::MathOverflow)?)
}

fn calculate_bid_ask_weight(amp: i16, bin_id: i32, center_bin_id: i32) -> Result<u16> {
    let bin_delta = bin_id.safe_sub(center_bin_id)?;
    let b = bin_delta.safe_mul(bin_delta)?;
    let weight = (amp as i32).safe_mul(b)?.safe_div(PRECISION)?;
    Ok(u16::try_from(weight).map_err(|_| LBError::MathOverflow)?)
}

impl ParabolicParameter {
    fn validate(&self, min_bin_id: i32, max_bin_id: i32) -> Result<()> {
        require!(self.a_right >= 0 && self.a_left >= 0, LBError::InvalidInput);
        require!(
            self.center_bin_id >= min_bin_id && self.center_bin_id <= max_bin_id,
            LBError::InvalidInput
        );
        Ok(())
    }

    fn get_b(&self, min_bin_id: i32, max_bin_id: i32) -> Result<(i32, i32)> {
        let b_left = min_bin_id.safe_sub(self.center_bin_id)?;
        let b_left: i32 = b_left.safe_mul(b_left)?;

        let b_right = max_bin_id.safe_sub(self.center_bin_id)?;
        let b_right = b_right.safe_mul(b_right)?;

        Ok((b_left, b_right))
    }

    fn get_curve_weight_at_bin_id(
        &self,
        bin_id: i32,
        b_left: i32,  // (center_bin_id-min_bin_id)^2
        b_right: i32, // (center_bin_id-max_bin_id)^2
    ) -> Result<u16> {
        if bin_id < self.center_bin_id {
            // bin_id is between min_bin_id and center_bin_id
            let bin_delta = bin_id.safe_sub(self.center_bin_id)?;
            let b_delta = bin_delta.safe_mul(bin_delta)?;
            calculate_curve_weight(self.a_left, b_left, b_delta)
        } else if bin_id > self.center_bin_id {
            // bin_id is between center_bin_id and max_bin_id
            let bin_delta = bin_id.safe_sub(self.center_bin_id)?;
            let b_delta = bin_delta.safe_mul(bin_delta)?;
            calculate_curve_weight(self.a_right, b_right, b_delta)
        } else {
            // bin_id == center_bin_id, favour side in larger b
            let (a, b) = if b_left > b_right {
                (self.a_left, b_left)
            } else {
                (self.a_right, b_right)
            };
            calculate_curve_weight(a, b, 0)
        }
    }

    fn get_bid_ask_weight_at_bin_id(&self, bin_id: i32) -> Result<u16> {
        if bin_id < self.center_bin_id {
            calculate_bid_ask_weight(self.a_left, bin_id, self.center_bin_id)
        } else if bin_id > self.center_bin_id {
            calculate_bid_ask_weight(self.a_right, bin_id, self.center_bin_id)
        } else {
            Ok(0)
        }
    }
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
impl StrategyParameters {
    fn parse_spot_parameter(&self) -> Result<SpotParameter> {
        Ok(SpotParameter::deserialize(&mut &self.parameteres[..])?)
    }
    fn parse_parabolic_parameter(&self) -> Result<ParabolicParameter> {
        Ok(ParabolicParameter::deserialize(&mut &self.parameteres[..])?)
    }
    pub fn to_weight_distribution(&self) -> Result<Vec<BinLiquidityDistributionByWeight>> {
        if self.max_bin_id < self.min_bin_id {
            return Err(LBError::InvalidInput.into());
        }
        let mut bin_liquidity_dist = vec![];
        if self.max_bin_id == self.min_bin_id {
            // only 1 bin
            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                bin_id: self.max_bin_id,
                weight: 1,
            });
        } else {
            match self.strategy_type {
                StrategyType::Spot => {
                    let spot_parameters = self.parse_spot_parameter()?;

                    for i in self.min_bin_id..=self.max_bin_id {
                        if i < spot_parameters.center_bin_id {
                            if spot_parameters.weight_left == 0 {
                                continue;
                            }
                            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                                bin_id: i,
                                weight: spot_parameters.weight_left,
                            })
                        }
                        if i == spot_parameters.center_bin_id {
                            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                                bin_id: i,
                                weight: spot_parameters
                                    .weight_right
                                    .max(spot_parameters.weight_left),
                            })
                        }
                        if i > spot_parameters.center_bin_id {
                            if spot_parameters.weight_right == 0 {
                                continue;
                            }
                            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                                bin_id: i,
                                weight: spot_parameters.weight_right,
                            })
                        }
                    }
                }
                StrategyType::Curve => {
                    let curve_parameters = self.parse_parabolic_parameter()?;
                    curve_parameters.validate(self.min_bin_id, self.max_bin_id)?;

                    let (b_left, b_right) =
                        curve_parameters.get_b(self.min_bin_id, self.max_bin_id)?;

                    for i in self.min_bin_id..=self.max_bin_id {
                        let weight =
                            curve_parameters.get_curve_weight_at_bin_id(i, b_left, b_right)?;
                        // filter zero weight
                        if weight == 0 {
                            continue;
                        }
                        bin_liquidity_dist
                            .push(BinLiquidityDistributionByWeight { bin_id: i, weight });
                    }
                }
                StrategyType::BidAsk => {
                    let curve_parameters = self.parse_parabolic_parameter()?;
                    curve_parameters.validate(self.min_bin_id, self.max_bin_id)?;

                    for i in self.min_bin_id..=self.max_bin_id {
                        let weight = curve_parameters.get_bid_ask_weight_at_bin_id(i)?;
                        // filter zero weight
                        if weight == 0 {
                            continue;
                        }

                        bin_liquidity_dist
                            .push(BinLiquidityDistributionByWeight { bin_id: i, weight });
                    }
                }
            };
        }

        Ok(bin_liquidity_dist)
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
    add_liquidity_by_weight::handle(
        &ctx,
        &liquidity_parameter.to_liquidity_parameter_by_weight()?,
    )
}

pub fn parabonic_to_slice(parameter: &ParabolicParameter) -> [u8; 64] {
    let mut buffer: Vec<u8> = vec![];
    parameter.serialize(&mut buffer).unwrap();
    let mut parameteres_slice = [0; 64];
    parameteres_slice[..8].clone_from_slice(&buffer.as_slice());
    parameteres_slice
}

pub fn spot_to_slice(parameter: &SpotParameter) -> [u8; 64] {
    let mut buffer: Vec<u8> = vec![];
    parameter.serialize(&mut buffer).unwrap();
    let mut parameteres_slice = [0; 64];
    parameteres_slice[..8].clone_from_slice(&buffer.as_slice());
    parameteres_slice
}
