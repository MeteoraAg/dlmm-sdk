use crate::errors::ErrorCode;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use dlmm_program_interface::{
    constants::BASIS_POINT_MAX,
    errors::LBError,
    state::{
        lb_pair::LbPair,
        oracle::{Oracle, OracleContentLoader},
    },
};

#[derive(Accounts)]
pub struct GetTwap<'info> {
    #[account(
        has_one = oracle @ LBError::MissingOracle,
        has_one = token_x_mint @ LBError::InvalidTokenMint,
        has_one = token_y_mint @ LBError::InvalidTokenMint,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    pub oracle: AccountLoader<'info, Oracle>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle(ctx: Context<GetTwap>, seconds_ago: i64) -> Result<f64> {
    require!(seconds_ago > 0, ErrorCode::InvalidLookupTimestamp);

    let lb_pair = ctx.accounts.lb_pair.load()?;
    let current_timestamp = Clock::get()?.unix_timestamp;
    let lookup_timestamp = current_timestamp - seconds_ago;

    let oracle = ctx.accounts.oracle.load_content()?;

    // Observation 0
    let cumulative_active_bin_id_0 =
        oracle.get_sample(lb_pair.active_id, current_timestamp, lookup_timestamp)?;
    // Observation 1
    let cumulative_active_bin_id_1 =
        oracle.get_sample(lb_pair.active_id, current_timestamp, current_timestamp)?;

    let active_bin_id = cumulative_active_bin_id_1 - cumulative_active_bin_id_0;
    let elapsed_seconds = current_timestamp - lookup_timestamp;

    let time_weighted_active_bin_id = active_bin_id / elapsed_seconds as i128;

    // Formula: 1.0 + bin_step / 10000 ** bin_id
    let base = 1.0 + lb_pair.bin_step as f64 / BASIS_POINT_MAX as f64;
    let price = base.powi(time_weighted_active_bin_id as i32);

    let ui_price = price * 10.0_f64.powi(ctx.accounts.token_x_mint.decimals.into())
        / 10.0_f64.powi(ctx.accounts.token_y_mint.decimals.into());

    Ok(ui_price)
}
