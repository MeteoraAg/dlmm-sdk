use crate::authorize_modify_position;
use crate::math::safe_math::SafeMath;
use crate::state::dynamic_position::{DynamicPositionLoader, PositionV3};
use crate::BinArrayAccount;
use crate::{
    manager::bin_array_manager::BinArrayManager,
    state::{bin::BinArray, lb_pair::LbPair},
};
use anchor_lang::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Accounts)]
pub struct UpdateFeesAndRewards<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, owner.key())?
    )]
    pub position: AccountLoader<'info, PositionV3>,

    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    pub owner: Signer<'info>,
}

pub fn handle(ctx: Context<UpdateFeesAndRewards>, min_bin_id: i32, max_bin_id: i32) -> Result<()> {
    Ok(())
}
