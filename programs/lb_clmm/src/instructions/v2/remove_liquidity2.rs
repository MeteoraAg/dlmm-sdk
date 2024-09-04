use anchor_lang::prelude::*;

use crate::{
    utils::remaining_accounts_util::RemainingAccountsSlice, BinLiquidityReduction, ModifyLiquidity2,
};

pub fn handle(
    ctx: Context<ModifyLiquidity2>,
    bin_liquidity_reduction: Vec<BinLiquidityReduction>,
    remaining_accounts_slice: &[RemainingAccountsSlice],
) -> Result<()> {
    Ok(())
}
