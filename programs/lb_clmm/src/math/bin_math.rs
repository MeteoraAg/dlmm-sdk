use crate::errors::LBError;

use super::safe_math::SafeMath;
use super::u64x64_math::SCALE_OFFSET;
use anchor_lang::prelude::Result;
use ruint::aliases::U256;

/// Calculate the amount of liquidity following the constant sum formula `L = price * x + y`
/// Price is in Q64x64
pub fn get_liquidity(x: u64, y: u64, price: u128) -> Result<u128> {
    // Q64x0
    let x: U256 = U256::from(x);

    // Multiplication do not require same Q number format. px is in Q64x64
    let price = U256::from(price);
    let px = price.safe_mul(x)?;

    // When perform add, both must be same Q number format. Therefore << SCALE_OFFSET to make y and px Q64x64
    let y = u128::from(y).safe_shl(SCALE_OFFSET.into())?;
    let y = U256::from(y);
    // Liquidity represented with fractional part
    let liquidity = px.safe_add(U256::from(y))?;
    Ok(liquidity.try_into().map_err(|_| LBError::TypeCastFailed)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::BASIS_POINT_MAX;
    use crate::math::{
        price_math::get_price_from_id,
        u64x64_math::{to_decimal, PRECISION},
    };

    #[test]
    fn test_get_liquidity() {
        let x = 21116312;
        let y = 122265385;

        let active_id = 5555;
        let bin_step = 10;

        let price = get_price_from_id(active_id, bin_step).unwrap();
        println!("price in fixed point {:?}", price);

        let liquidity = get_liquidity(x, y, price).unwrap().try_into().unwrap();
        println!("liquidity in fixed point {:?}", liquidity);

        assert_eq!(liquidity, 102679554235059215585763858120u128);

        let liquidity_conv = (liquidity as f64) / 2.0f64.powi(64);
        println!("liquidity converted to float {}", liquidity_conv);

        let liquidity_d = to_decimal(liquidity).unwrap();
        println!("liquidity in decimal {}", liquidity_d);

        let price = (1.0f64 + bin_step as f64 / BASIS_POINT_MAX as f64).powi(active_id);
        let liquidity_f = price * x as f64 + y as f64;
        println!("liquidity computed in float {:?}", liquidity_f);

        let liquidity_d = liquidity_d / PRECISION;
        let liquidity_f = liquidity_f.floor() as u128;
        let liquidity_conv = liquidity_conv.floor() as u128;

        assert_eq!(liquidity_d, liquidity_f);
        assert_eq!(liquidity_d, liquidity_conv);
    }
}
