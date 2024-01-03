use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anyhow::*;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::state::lb_pair::LbPair;
use rust_decimal::Decimal;

use crate::math::get_id_from_price;

use super::initialize_bin_array_with_bin_range::{
    initialize_bin_array_with_bin_range, InitBinArrayWithBinRangeParameters,
};

#[derive(Debug)]
pub struct InitBinArrayWithPriceRangeParameters {
    pub lb_pair: Pubkey,
    pub lower_price: f64,
    pub upper_price: f64,
}

pub fn initialize_bin_array_with_price_range<C: Deref<Target = impl Signer> + Clone>(
    params: InitBinArrayWithPriceRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Vec<Pubkey>> {
    let InitBinArrayWithPriceRangeParameters {
        lb_pair,
        lower_price,
        upper_price,
    } = params;

    let lb_pair_state = program.account::<LbPair>(lb_pair)?;

    let lower_bin_id = get_id_from_price(
        lb_pair_state.bin_step,
        &Decimal::from_f64_retain(lower_price).context("lower price overflow")?,
        Rounding::Down,
    )
    .context("get_id_from_price overflow")?;

    let upper_bin_id = get_id_from_price(
        lb_pair_state.bin_step,
        &Decimal::from_f64_retain(upper_price).context("upper price overflow")?,
        Rounding::Up,
    )
    .context("get_id_from_price overflow")?;

    let params = InitBinArrayWithBinRangeParameters {
        lb_pair,
        lower_bin_id,
        upper_bin_id,
    };

    initialize_bin_array_with_bin_range(params, program, transaction_config)
}
