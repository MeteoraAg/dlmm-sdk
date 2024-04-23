use anchor_lang::prelude::*;

use crate::state::lb_pair::LbPair;
use crate::BinArrayAccount;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Accounts)]
pub struct MigrateBinArray<'info> {
    pub lb_pair: AccountLoader<'info, LbPair>,
}

pub fn handle(ctx: Context<MigrateBinArray>) -> Result<()> {
    Ok(())
}
