use anyhow::{anyhow, Result};
use commons::{get_price_from_id, BASIS_POINT_MAX, SCALE_OFFSET};
use dlmm_interface::Rounding;
use rust_decimal::MathematicalOps;
use rust_decimal::{
    prelude::{FromPrimitive, ToPrimitive},
    Decimal,
};

pub fn find_swappable_min_max_bin_id(bin_step: u16) -> Result<(i32, i32)> {
    let base = 1.0f64 + (bin_step as f64 / BASIS_POINT_MAX as f64);
    let max_price_supported = 2.0f64.powi(64); // We use u64xu64 math
    let n = (max_price_supported.log10() / base.log10()) as i32;

    let mut min_bin_id = -n;
    let mut max_bin_id = n;

    let min_q64_price = 1;
    let max_q64_price = u128::MAX;

    loop {
        match get_price_from_id(min_bin_id, bin_step) {
            Ok(price) => {
                if price > min_q64_price {
                    break;
                } else {
                    min_bin_id += 1;
                }
            }
            Err(_) => {
                min_bin_id += 1;
            }
        }
    }

    loop {
        match get_price_from_id(max_bin_id, bin_step) {
            Ok(price) => {
                if price < max_q64_price {
                    break;
                } else {
                    max_bin_id -= 1;
                }
            }
            Err(_) => {
                max_bin_id -= 1;
            }
        }
    }

    Ok((min_bin_id, max_bin_id))
}

pub fn compute_base_factor_from_fee_bps(bin_step: u16, fee_bps: u16) -> Result<u16> {
    let computed_base_factor = fee_bps as f64 * 10_000.0f64 / bin_step as f64;

    // Sanity check
    let casted_base_factor = computed_base_factor as u16 as f64;
    if casted_base_factor != computed_base_factor {
        if casted_base_factor == u16::MAX as f64 {
            return Err(anyhow!("overflow"));
        }

        if casted_base_factor == 0.0f64 {
            return Err(anyhow!("underflow"));
        }

        if computed_base_factor.fract() != 0.0 {
            return Err(anyhow!("have decimals"));
        }

        return Err(anyhow!("unknown error"));
    }

    Ok(computed_base_factor as u16)
}

pub fn get_precise_id_from_price(bin_step: u16, price: &Decimal) -> Option<i32> {
    let bps = Decimal::from_u16(bin_step)?.checked_div(Decimal::from_i32(BASIS_POINT_MAX)?)?;
    let base = Decimal::ONE.checked_add(bps)?;

    let id = price.log10().checked_div(base.log10())?.to_f64()?;
    let trimmed_id = id as i32;
    let trimmed_id_f64 = trimmed_id as f64;

    if trimmed_id_f64 == id {
        id.to_i32()
    } else {
        None
    }
}

/// Calculate the bin id based on price. If the bin id is in between 2 bins, it will round up.
pub fn get_id_from_price(bin_step: u16, price: &Decimal, rounding: Rounding) -> Option<i32> {
    let bps = Decimal::from_u16(bin_step)?.checked_div(Decimal::from_i32(BASIS_POINT_MAX)?)?;
    let base = Decimal::ONE.checked_add(bps)?;

    let id = match rounding {
        Rounding::Down => price.log10().checked_div(base.log10())?.floor(),
        Rounding::Up => price.log10().checked_div(base.log10())?.ceil(),
    };

    id.to_i32()
}

/// Convert Q64xQ64 price to human readable decimal. This is price per lamport.
pub fn q64x64_price_to_decimal(q64x64_price: u128) -> Option<Decimal> {
    let q_price = Decimal::from_u128(q64x64_price)?;
    let scale_off = Decimal::TWO.powu(SCALE_OFFSET.into());
    q_price.checked_div(scale_off)
}

/// price_per_lamport = price_per_token * 10 ** quote_token_decimal / 10 ** base_token_decimal
pub fn price_per_token_to_per_lamport(
    price_per_token: f64,
    base_token_decimal: u8,
    quote_token_decimal: u8,
) -> Option<Decimal> {
    let price_per_token = Decimal::from_f64(price_per_token)?;
    price_per_token
        .checked_mul(Decimal::TEN.powu(quote_token_decimal.into()))?
        .checked_div(Decimal::TEN.powu(base_token_decimal.into()))
}

/// price_per_token = price_per_lamport * 10 ** base_token_decimal / 10 ** quote_token_decimal, Solve for price_per_lamport
pub fn price_per_lamport_to_price_per_token(
    price_per_lamport: f64,
    base_token_decimal: u8,
    quote_token_decimal: u8,
) -> Option<Decimal> {
    let one_ui_base_token_amount = Decimal::TEN.powu(base_token_decimal.into());
    let one_ui_quote_token_amount = Decimal::TEN.powu(quote_token_decimal.into());
    let price_per_lamport = Decimal::from_f64(price_per_lamport)?;

    one_ui_base_token_amount
        .checked_mul(price_per_lamport)?
        .checked_div(one_ui_quote_token_amount)
}
