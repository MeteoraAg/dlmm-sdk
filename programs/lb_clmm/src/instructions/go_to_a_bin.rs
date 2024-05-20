use crate::errors::LBError;
use crate::events::GoToABin as GoToABinEvent;
use crate::math::safe_math::SafeMath;
use crate::state::bin::BinArray;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::lb_pair::LbPair;
use anchor_lang::prelude::*;
/// this endpoint allows user to go from current lb.active_id to a bin id x, if there is no liquidity between lb.active_id and bin id x
#[event_cpi]
#[derive(Accounts)]
pub struct GoToABin<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        has_one = lb_pair,
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,
    #[account(
        has_one = lb_pair,
    )]
    pub from_bin_array: Option<AccountLoader<'info, BinArray>>, // binArray includes current lb_pair.active_id
    #[account(
        has_one = lb_pair,
    )]
    pub to_bin_array: Option<AccountLoader<'info, BinArray>>, // binArray includes bin_id
}

pub fn handle(ctx: Context<GoToABin>, bin_id: i32) -> Result<()> {
    Ok(())
}
