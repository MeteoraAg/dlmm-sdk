use super::add_liquidity::ModifyLiquidity;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct BinLiquidityReduction {
    pub bin_id: i32,
    pub bps_to_remove: u16,
}

#[allow(unused_variables)]
pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    bin_liquidity_reduction: Vec<BinLiquidityReduction>,
) -> Result<()> {
    // No-op, an interface
    Ok(())
}
