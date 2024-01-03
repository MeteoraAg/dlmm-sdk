use crate::ModifyLiquidity;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct BinLiquidityDistributionByWeight {
    /// Define the bin ID wish to deposit to.
    pub bin_id: i32,
    /// weight of liquidity distributed for this bin id
    pub weight: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityParameterByWeight {
    /// Amount of X token to deposit
    pub amount_x: u64,
    /// Amount of Y token to deposit
    pub amount_y: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    liquidity_parameter: &LiquidityParameterByWeight,
) -> Result<()> {
    Ok(())
}
