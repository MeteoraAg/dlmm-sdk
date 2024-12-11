use anchor_lang::prelude::*;

use crate::ModifyLiquidity;

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
) -> Result<()> {
    Ok(())
}
