use super::deposit::add_liquidity::ModifyLiquidity;
use crate::errors::LBError;
use crate::instructions::remove_liquidity::RemoveLiquidity;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::state::bin::BinArray;
use crate::state::dynamic_position::DynamicPositionLoader;
use crate::BinArrayAccount;
use crate::PositionLiquidityFlowValidator;
use crate::{events::RemoveLiquidity as RemoveLiquidityEvent, math::safe_math::SafeMath};
use anchor_lang::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    min_bin_id: i32,
    max_bin_id: i32,
) -> Result<()> {
    Ok(())
}
