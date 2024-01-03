use lb_clmm::constants::BASIS_POINT_MAX;
use lb_clmm::math::u128x128_math::Rounding;
use rust_decimal::MathematicalOps;
use rust_decimal::{
    prelude::{FromPrimitive, ToPrimitive},
    Decimal,
};

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
    let scale_off = Decimal::TWO.powu(lb_clmm::math::u64x64_math::SCALE_OFFSET.into());
    q_price.checked_div(scale_off)
}

/// price_per_lamport = price_per_token * 10 ** quote_token_decimal / 10 ** base_token_decimal
pub fn price_per_token_to_per_lamport(
    price_per_token: f64,
    base_token_decimal: u8,
    quote_token_decimal: u8,
) -> Option<Decimal> {
    let price_per_token = Decimal::from_f64(price_per_token)?;
    Some(
        price_per_token
            .checked_mul(Decimal::TEN.powu(quote_token_decimal.into()))?
            .checked_div(Decimal::TEN.powu(base_token_decimal.into()))?,
    )
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

    Some(
        one_ui_base_token_amount
            .checked_mul(price_per_lamport)?
            .checked_div(one_ui_quote_token_amount)?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use lb_clmm::math::{price_math::get_price_from_id, u64x64_math::SCALE_OFFSET};
    use proptest::proptest;

    proptest! {
        #[test]
        fn test_get_id_from_price_range(
            bin_step in 1..=BASIS_POINT_MAX as u16,
            price in 0.000000000000000001f64..=u64::MAX as f64
        ) {
            let price = Decimal::from_f64(price);
            assert!(price.is_some());
            let id = get_id_from_price(bin_step, &price.unwrap(), Rounding::Up);
            assert!(id.is_some());
        }
    }

    #[test]
    fn test_q64x64_price_to_decimal() {
        let q64x64_price: u128 = 408988714829317079040;
        let decimal_price = q64x64_price_to_decimal(q64x64_price);

        assert!(decimal_price.is_some());
        assert_eq!(
            decimal_price.unwrap().to_string(),
            "22.17132265700000104402533907"
        );
    }

    #[test]
    fn test_price_per_lamport_to_price_per_token() {
        let price_per_lamport = 0.211713226574294_f64;
        let base_token_decimal = 8u8;
        let quote_token_decimal = 6u8;

        let price_per_token = price_per_lamport_to_price_per_token(
            price_per_lamport,
            base_token_decimal,
            quote_token_decimal,
        );
        assert!(price_per_token.is_some());

        let recomputed_price_per_lamport = price_per_token.unwrap()
            * Decimal::TEN.powu(quote_token_decimal.into())
            / Decimal::TEN.powu(base_token_decimal.into());

        let recomputed_price_per_lamport = recomputed_price_per_lamport.to_f64();
        assert!(recomputed_price_per_lamport.is_some());
        assert_eq!(Some(price_per_lamport), recomputed_price_per_lamport);
    }

    #[test]
    fn test_price_per_token_to_per_lamport() {
        let price_per_token = 9.95769;
        let base_token_decimal = 8u8;
        let quote_token_decimal = 6u8;

        let price_per_lamport = price_per_token_to_per_lamport(
            price_per_token,
            base_token_decimal,
            quote_token_decimal,
        );
        assert!(price_per_lamport.is_some());

        let recomputed_price_per_token = price_per_lamport.unwrap()
            * Decimal::TEN.powu(base_token_decimal.into())
            / Decimal::TEN.powu(quote_token_decimal.into());

        let recomputed_price_per_token = recomputed_price_per_token.to_f64();
        assert!(recomputed_price_per_token.is_some());

        assert_eq!(Some(price_per_token), recomputed_price_per_token);
    }

    #[test]
    fn test_get_id_from_price() {
        let bin_step = 15;
        let quote_decimal = 6u8;
        let price = Decimal::from_f64(208.929000).unwrap();

        let computed_id = get_id_from_price(bin_step, &price, Rounding::Up);
        assert!(computed_id.is_some());

        let program_computed_price = get_price_from_id(computed_id.unwrap(), bin_step);
        assert!(program_computed_price.is_ok());

        let computed_price_fixed = Decimal::from_u128(program_computed_price.unwrap());
        assert!(computed_price_fixed.is_some());

        let fixed_to_dec_scale_off = Decimal::TWO.powu(SCALE_OFFSET.into());

        let computed_price_dec = (computed_price_fixed.unwrap()
            * Decimal::TEN.powu(quote_decimal.into())
            / fixed_to_dec_scale_off)
            .floor();

        let computed_price = computed_price_dec.to_u64();
        assert_eq!(computed_price, Some(208929004));
    }
}
