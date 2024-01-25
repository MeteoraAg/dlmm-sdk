use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anyhow::*;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::state::lb_pair::LbPair;
use rust_decimal::Decimal;

use crate::math::get_id_from_price;

use super::initialize_position::{initialize_position, InitPositionParameters};

#[derive(Debug)]
pub struct InitPositionWithPriceRangeParameters {
    pub lb_pair: Pubkey,
    pub lower_price: f64,
    pub width: i32,
    pub nft_mint: Option<Pubkey>,
}

pub async fn initialize_position_with_price_range<C: Deref<Target = impl Signer> + Clone>(
    params: InitPositionWithPriceRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPositionWithPriceRangeParameters {
        lb_pair,
        lower_price,
        width,
        nft_mint,
    } = params;

    let lb_pair_state = program.account::<LbPair>(lb_pair).await?;

    let lower_bin_id = get_id_from_price(
        lb_pair_state.bin_step,
        &Decimal::from_f64_retain(lower_price).context("lower price overflow")?,
        Rounding::Down,
    )
    .context("get_id_from_price overflow")?;

    let params = InitPositionParameters {
        lb_pair,
        lower_bin_id,
        width,
        nft_mint,
    };

    initialize_position(params, program, transaction_config).await
}
