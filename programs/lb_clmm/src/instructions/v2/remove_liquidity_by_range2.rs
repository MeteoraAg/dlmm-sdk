use crate::utils::remaining_accounts_util::RemainingAccountsInfo;
use crate::ModifyLiquidity2;
use anchor_lang::prelude::*;

pub fn handle(
    ctx: Context<ModifyLiquidity2>,
    min_bin_id: i32,
    max_bin_id: i32,
    bps: u16,
    remaining_accounts_info: RemainingAccountsInfo,
) -> Result<()> {
    Ok(())
}
