use super::safe_math::SafeMath;
use super::u64x64_math::{pow, ONE, SCALE_OFFSET};
use crate::constants::BASIS_POINT_MAX;
use crate::errors::LBError;
use anchor_lang::prelude::*;

// In Trader Joe, the active_id need to be shifted by 2 ** 23 to get the actual ID.
// The reason is because they mint LP for each bin based on active_id using ERC1155, which the ID do not support negative

/// Calculate price based on the given bin id. Eg: 1.0001 ^ 5555. The returned value is in Q64.64
pub fn get_price_from_id(active_id: i32, bin_step: u16) -> Result<u128> {
    // Make bin_step into Q64x64, and divided by BASIS_POINT_MAX. If bin_step = 1, we get 0.0001 in Q64x64
    let bps = u128::from(bin_step)
        .safe_shl(SCALE_OFFSET.into())?
        .safe_div(BASIS_POINT_MAX as u128)?;
    // Add 1 to bps, we get 1.0001 in Q64.64
    let base = ONE.safe_add(bps)?;
    pow(base, active_id).ok_or_else(|| LBError::MathOverflow.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::u64x64_math::to_decimal;

    #[test]
    fn test_get_price_from_positive_id() {
        let active_id = 5555;
        let bin_step = 10;

        let price = get_price_from_id(active_id, bin_step).unwrap();
        let decimal_price = to_decimal(price).unwrap();
        println!("Decimal price (10^12 precision) {}", decimal_price);

        assert_eq!(decimal_price.to_string(), "257810379178651");

        let base = 1.0f64 + bin_step as f64 / BASIS_POINT_MAX as f64;
        let price = base.powi(active_id);
        println!("Float price {}", price);
    }

    #[test]
    fn test_get_price_from_negative_id() {
        let active_id = -5555;
        let bin_step = 10;

        let price = get_price_from_id(active_id, bin_step).unwrap();
        let decimal_price = to_decimal(price).unwrap();

        println!("Decimal price (10^12 precision) {}", decimal_price);

        assert_eq!(decimal_price.to_string(), "3878819786");

        let base = 1.0f64 + bin_step as f64 / BASIS_POINT_MAX as f64;
        let price = base.powi(active_id);
        println!("Float price {}", price);
    }
}
