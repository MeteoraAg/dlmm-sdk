use crate::state::oracle::Oracle;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(length_to_add: u64)]
pub struct IncreaseOracleLength<'info> {
    #[account(mut)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(unused_variables)]
pub fn handle(ctx: Context<IncreaseOracleLength>, length_to_add: u64) -> Result<()> {
    // No-op, an interface
    Ok(())
}
