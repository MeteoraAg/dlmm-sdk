use crate::constants::BASIS_POINT_MAX;
use crate::errors::LBError;
use crate::{BinLiquidityReduction, ModifyLiquidity};
use anchor_lang::prelude::*;

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    min_bin_id: i32,
    max_bin_id: i32,
    bps: u16,
) -> Result<()> {
    Ok(())
}
