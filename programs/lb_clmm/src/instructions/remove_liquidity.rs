use super::add_liquidity::ModifyLiquidity;
use anchor_lang::prelude::*;
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct BinLiquidityReduction {
    pub bin_id: i32,
    pub bps_to_remove: u16,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    bin_liquidity_reduction: Vec<BinLiquidityReduction>,
) -> Result<()> {
    Ok(())
}
