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
    pub fn to_liquidity_parameter_by_weight(
        &self,
        active_id: i32,
    ) -> Result<LiquidityParameterByWeight> {
        Ok(LiquidityParameterByWeight {
            amount_x: self.amount_x,
            amount_y: self.amount_y,
            active_id: self.active_id,
            max_active_bin_slippage: self.max_active_bin_slippage,
            bin_liquidity_dist: self.strategy_parameters.to_weight_distribution(active_id)?, // TODO: should we use  lb_pair.active_id?
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
    /// amplification in ask side
    pub a_ask: i16,
    /// amplification in bid side
    pub a_bid: i16,
    /// amplification in active bin
    pub a_active_bin: i16,
    /// center bin id
    pub center_bin_id: i32,
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

impl ParabolicParameter {
    fn validate_curve(&self) -> Result<()> {
        require!(
            self.a_ask <= 0 && self.a_bid <= 0 && self.a_active_bin <= 0,
            LBError::InvalidInput
        );
        Ok(())
    }

    fn validate_bid_ask(&self) -> Result<()> {
        require!(
            self.a_ask >= 0 && self.a_bid >= 0 && self.a_active_bin >= 0,
            LBError::InvalidInput
        );
        Ok(())
    }

    fn get_curve_weight_at_bin_id(
        &self,
        center_bin_id: i32,
        bin_id: i32,
        b: i32,
        active_id: i32,
    ) -> Result<u16> {
        let a: i32 = if bin_id < active_id {
            self.a_bid.into()
        } else if bin_id > active_id {
            self.a_ask.into()
        } else {
            self.a_active_bin.into()
        };

        let bin_delta = bin_id.safe_sub(center_bin_id)?;

        let weight = (a
            .safe_mul(bin_delta)?
            .safe_mul(bin_delta)?
            .safe_sub(a.safe_mul(b)?)?)
        .safe_div(PRECISION)?;

        Ok(u16::try_from(weight.max(0)).map_err(|_| LBError::MathOverflow)?)
    }

    fn get_bid_ask_weight_at_bin_id(
        &self,
        center_bin_id: i32,
        bin_id: i32,
        active_id: i32,
    ) -> Result<u16> {
        let a: i32 = if bin_id < active_id {
            self.a_bid.into()
        } else if bin_id > active_id {
            self.a_ask.into()
        } else {
            self.a_active_bin.into()
        };

        let bin_delta = bin_id.safe_sub(center_bin_id)?;

        let weight = a
            .safe_mul(bin_delta)?
            .safe_mul(bin_delta)?
            .safe_div(PRECISION)?;

        Ok(u16::try_from(weight.max(0)).map_err(|_| LBError::MathOverflow)?)
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
    pub fn to_weight_distribution(
        &self,
        active_id: i32,
    ) -> Result<Vec<BinLiquidityDistributionByWeight>> {
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
                        if i < active_id {
                            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                                bin_id: i,
                                weight: spot_parameters.weight_bid,
                            })
                        }
                        if i > active_id {
                            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                                bin_id: i,
                                weight: spot_parameters.weight_ask,
                            })
                        }
                        if i == active_id {
                            bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                                bin_id: i,
                                weight: spot_parameters.weight_active_bin,
                            })
                        }
                    }
                }
                StrategyType::Curve => {
                    let curve_parameters = self.parse_parabolic_parameter()?;
                    curve_parameters.validate_curve()?;
                    let mid_bin_id = curve_parameters.center_bin_id;
                    let bin_width = self.max_bin_id.safe_sub(self.min_bin_id)?;
                    let b = bin_width.safe_mul(bin_width)?;

                    for i in self.min_bin_id..=self.max_bin_id {
                        let weight = curve_parameters
                            .get_curve_weight_at_bin_id(mid_bin_id, i, b, active_id)?;

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
                    curve_parameters.validate_bid_ask()?;
                    let mid_bin_id = curve_parameters.center_bin_id;
                    for i in self.min_bin_id..=self.max_bin_id {
                        let weight = curve_parameters
                            .get_bid_ask_weight_at_bin_id(mid_bin_id, i, active_id)?;
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
    let active_id = ctx.accounts.lb_pair.load()?.active_id;
    add_liquidity_by_weight::handle(
        &ctx,
        &liquidity_parameter.to_liquidity_parameter_by_weight(active_id)?,
    )
}
