use ruint::aliases::U256;

// Round up, down
#[derive(PartialEq)]
pub enum Rounding {
    Up,
    Down,
}

/// (x * y) / denominator
pub fn mul_div(x: u128, y: u128, denominator: u128, rounding: Rounding) -> Option<u128> {
    if denominator == 0 {
        return None;
    }

    let x = U256::from(x);
    let y = U256::from(y);
    let denominator = U256::from(denominator);

    let prod = x.checked_mul(y)?;

    match rounding {
        Rounding::Up => prod.div_ceil(denominator).try_into().ok(),
        Rounding::Down => {
            let (quotient, _) = prod.div_rem(denominator);
            quotient.try_into().ok()
        }
    }
}

/// (x * y) >> offset
#[inline]
pub fn mul_shr(x: u128, y: u128, offset: u8, rounding: Rounding) -> Option<u128> {
    let denominator = 1u128.checked_shl(offset.into())?;
    mul_div(x, y, denominator, rounding)
}

/// (x << offset) / y
#[inline]
pub fn shl_div(x: u128, y: u128, offset: u8, rounding: Rounding) -> Option<u128> {
    let scale = 1u128.checked_shl(offset.into())?;
    mul_div(x, scale, y, rounding)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::proptest;

    #[test]
    fn test_mul_div() {
        assert_eq!(mul_div(33, 3, 2, Rounding::Up), Some(50));
        assert_eq!(mul_div(33, 3, 2, Rounding::Down), Some(49));

        assert_eq!(mul_div(30, 3, 2, Rounding::Up), Some(45));
        assert_eq!(mul_div(30, 3, 2, Rounding::Down), Some(45));

        assert_eq!(mul_div(30, 0, 2, Rounding::Up), Some(0));
        assert_eq!(mul_div(30, 0, 2, Rounding::Down), Some(0));
    }

    #[test]
    fn test_mul_div_over_underflow() {
        assert_eq!(mul_div(33, 3, 0, Rounding::Up), None);
        assert_eq!(mul_div(33, 3, 0, Rounding::Down), None);

        assert_eq!(
            mul_div(u128::MAX, u128::MAX, u128::MAX - 1, Rounding::Up),
            None
        );
        assert_eq!(
            mul_div(u128::MAX, u128::MAX, u128::MAX - 1, Rounding::Down),
            None
        );
    }

    #[test]
    fn test_mul_div_max() {
        assert_eq!(
            mul_div(u128::MAX, u128::MAX, u128::MAX, Rounding::Up),
            Some(u128::MAX)
        );
        assert_eq!(
            mul_div(u128::MAX, u128::MAX, u128::MAX, Rounding::Down),
            Some(u128::MAX)
        );
    }

    #[test]
    fn test_mul_shr() {
        assert_eq!(mul_shr(33, 3, 1, Rounding::Up), Some(50));
        assert_eq!(mul_shr(33, 3, 1, Rounding::Down), Some(49));

        assert_eq!(mul_shr(33, 3, 0, Rounding::Up), Some(99));
        assert_eq!(mul_shr(33, 3, 0, Rounding::Down), Some(99));
    }

    #[test]
    fn test_mul_shr_overflow() {
        assert!(mul_shr(
            240615969200000000000000000000000000000u128,
            240615969200000000000000000000000000000u128,
            127,
            Rounding::Up
        )
        .is_none());
        assert!(mul_shr(
            240615969200000000000000000000000000000u128,
            240615969200000000000000000000000000000u128,
            127,
            Rounding::Down
        )
        .is_none());
    }

    #[test]
    fn test_shl_div() {
        assert_eq!(shl_div(33, 5, 1, Rounding::Up), Some(14));
        assert_eq!(shl_div(33, 5, 1, Rounding::Down), Some(13));

        assert_eq!(shl_div(33, 5, 0, Rounding::Up), Some(7));
        assert_eq!(shl_div(33, 5, 0, Rounding::Down), Some(6));
    }

    #[test]
    fn test_shl_div_overflow() {
        assert_eq!(shl_div(u128::MAX, 5, 127, Rounding::Up), None);
        assert_eq!(shl_div(u128::MAX, 5, 127, Rounding::Down), None);
    }

    #[test]
    fn test_shl_div_underflow() {
        assert_eq!(shl_div(33, 0, 1, Rounding::Up), None);
        assert_eq!(shl_div(33, 0, 1, Rounding::Down), None);
    }

    proptest! {
        #[test]
        fn test_shl_div_range(
            x in 0..=u128::MAX,
            y in 170141183460469231731687303715884105728..=u128::MAX
        ) {
            assert!(shl_div(x, y, 127, Rounding::Up).is_some());
            assert!(shl_div(x, y, 127, Rounding::Down).is_some());
        }

        #[test]
        fn test_shl_div_underflow_range(
            x in 0..=u128::MAX,
            offset in 0..=127u8
        ) {
            assert!(shl_div(x, 0, offset, Rounding::Up).is_none());
            assert!(shl_div(x, 0, offset, Rounding::Down).is_none());
        }

        #[test]
        fn test_shl_div_overflow_range(
            x in 2..=u128::MAX
        ) {
            assert!(shl_div(x, 1, 127, Rounding::Up).is_none());
            assert!(shl_div(x, 1, 127, Rounding::Down).is_none());
        }
    }

    proptest! {
        #[test]
        fn test_mul_shr_range(
            x in 0..=240615969100000000000000000000000000000u128,
            y in 0..=240615969100000000000000000000000000000u128,
        ) {
            assert!(mul_shr(x, y, 127, Rounding::Up).is_some());
            assert!(mul_shr(x, y, 127, Rounding::Down).is_some());
        }

        #[test]
        fn test_mul_shr_overflow_range(
            x in 240615969200000000000000000000000000000u128..=u128::MAX,
            y in 240615969200000000000000000000000000000u128..=u128::MAX,
        ) {
            assert!(mul_div(x, y, 127, Rounding::Up).is_none());
            assert!(mul_div(x, y, 127, Rounding::Down).is_none());
        }
    }

    proptest! {
        #[test]
        fn test_mul_div_range(
            x in 0..=u128::MAX,
            y in 0..=u128::MAX
        ) {
            assert!(mul_div(x, y, u128::MAX, Rounding::Up).is_some());
            assert!(mul_div(x, y, u128::MAX, Rounding::Down).is_some());
        }

        #[test]
        fn test_mul_div_overflow_range(
            x in u64::MAX as u128..=u128::MAX,
            y in u64::MAX as u128 + 1..=u128::MAX
        ) {
            assert!(mul_div(x, y, 1, Rounding::Up).is_none());
            assert!(mul_div(x, y, 1, Rounding::Down).is_none());
        }

         #[test]
        fn test_mul_div_underflow_range(
            x in 0..=u128::MAX,
            y in 0..=u128::MAX
        ) {
            assert!(mul_div(x, y, 0, Rounding::Up).is_none());
            assert!(mul_div(x, y, 0, Rounding::Down).is_none());
        }
    }
}
