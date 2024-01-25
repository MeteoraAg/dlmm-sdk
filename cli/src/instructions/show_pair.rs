use std::ops::Deref;

use anchor_client::solana_client::rpc_filter::{Memcmp, RpcFilterType};

use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_spl::token::Mint;
use anyhow::*;

use lb_clmm::constants::FEE_PRECISION;
use lb_clmm::math::price_math::get_price_from_id;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use rust_decimal::prelude::{FromPrimitive, ToPrimitive};
use rust_decimal::Decimal;

use crate::math::{price_per_lamport_to_price_per_token, q64x64_price_to_decimal};

fn fee_rate_to_fee_pct(fee_rate: u128) -> Option<Decimal> {
    let fee_rate = Decimal::from_u128(fee_rate)?.checked_div(Decimal::from(FEE_PRECISION))?;
    fee_rate.checked_mul(Decimal::ONE_HUNDRED)
}

pub async fn show_pair<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    program: &Program<C>,
) -> Result<()> {
    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let lb_pair_filter = RpcFilterType::Memcmp(Memcmp::new_base58_encoded(16, &lb_pair.to_bytes()));
    let mut bin_arrays: Vec<(Pubkey, BinArray)> = program.accounts(vec![lb_pair_filter]).await?;
    bin_arrays.sort_by(|a, b| a.1.index.cmp(&b.1.index));

    println!("{:#?}", lb_pair_state);

    for (_, bin_array) in bin_arrays {
        let (mut lower_bin_id, _) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array.index as i32)?;
        for bin in bin_array.bins.iter() {
            let total_amount = bin.amount_x + bin.amount_y;
            if total_amount > 0 {
                println!(
                    "Bin: {}, X: {}, Y: {}",
                    lower_bin_id, bin.amount_x, bin.amount_y
                );
            }
            lower_bin_id += 1;
        }
    }

    let x_mint: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let y_mint: Mint = program.account(lb_pair_state.token_y_mint).await?;

    let q64x64_price = get_price_from_id(lb_pair_state.active_id, lb_pair_state.bin_step)?;
    let decimal_price_per_lamport =
        q64x64_price_to_decimal(q64x64_price).context("q64x64 price to decimal overflow")?;

    let token_price = price_per_lamport_to_price_per_token(
        decimal_price_per_lamport
            .to_f64()
            .context("Decimal conversion to f64 fail")?,
        x_mint.decimals,
        y_mint.decimals,
    )
    .context("price_per_lamport_to_price_per_token overflow")?;

    let base_fee_rate = fee_rate_to_fee_pct(lb_pair_state.get_total_fee()?)
        .context("get_total_fee convert to percentage overflow")?;
    let variable_fee_rate = fee_rate_to_fee_pct(lb_pair_state.get_variable_fee()?)
        .context("get_total_fee convert to percentage overflow")?;
    let current_fee_rate = fee_rate_to_fee_pct(lb_pair_state.get_total_fee()?)
        .context("get_total_fee convert to percentage overflow")?;

    println!("Current price {}", token_price);
    println!("Base fee rate {}%", base_fee_rate);
    println!("Volatile fee rate {}%", variable_fee_rate);
    println!("Current fee rate {}%", current_fee_rate);

    Ok(())
}
