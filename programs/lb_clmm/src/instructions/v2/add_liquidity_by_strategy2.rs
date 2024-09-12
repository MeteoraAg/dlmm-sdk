use crate::{
    utils::remaining_accounts_util::RemainingAccountsInfo, LiquidityParameterByStrategy,
    ModifyLiquidity2,
};
use anchor_lang::prelude::*;

pub fn handle(
    ctx: Context<ModifyLiquidity2>,
    liquidity_parameter: &LiquidityParameterByStrategy,
    remaining_accounts_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}
