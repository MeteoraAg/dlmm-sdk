use crate::constants::BASIS_POINT_MAX;
use ruint::aliases::U256;

// Precision when converting from decimal to fixed point. Or the other way around. 10^12
pub const PRECISION: u128 = 1_000_000_000_000;

// Number of bits to scale. This will decide the position of the radix point.
pub const SCALE_OFFSET: u8 = 64;

// Where does this value come from ?
// When smallest bin is used (1 bps), the maximum of bin limit is 887272 (Check: https://docs.traderjoexyz.com/concepts/bin-math).
// But in solana, the token amount is represented in 64 bits, therefore, it will be (1 + 0.0001)^n < 2 ** 64, solve for n, n ~= 443636
// Then we calculate bits needed to represent 443636 exponential, 2^n >= 443636, ~= 19
// If we convert 443636 to binary form, it will be 1101100010011110100 (19 bits).
// Which, the 19 bits are the bits the binary exponential will loop through.
// The 20th bit will be 0x80000,  which the exponential already > the maximum number of bin Q64.64 can support
const MAX_EXPONENTIAL: u32 = 0x80000; // 1048576

// 1.0000... representation of 64x64
pub const ONE: u128 = 1u128 << SCALE_OFFSET;

pub fn pow(base: u128, exp: i32) -> Option<u128> {
    // If exponent is negative. We will invert the result later by 1 / base^exp.abs()
    let mut invert = exp.is_negative();

    // When exponential is 0, result will always be 1
    if exp == 0 {
        return Some(1u128 << 64);
    }

    // Make the exponential positive. Which will compute the result later by 1 / base^exp
    let exp: u32 = if invert { exp.abs() as u32 } else { exp as u32 };

    // No point to continue the calculation as it will overflow the maximum value Q64.64 can support
    if exp >= MAX_EXPONENTIAL {
        return None;
    }

    let mut squared_base = base;
    let mut result = ONE;

    // When multiply the base twice, the number of bits double from 128 -> 256, which overflow.
    // The trick here is to inverse the calculation, which make the upper 64 bits (number bits) to be 0s.
    // For example:
    // let base = 1.001, exp = 5
    // let neg = 1 / (1.001 ^ 5)
    // Inverse the neg: 1 / neg
    // By using a calculator, you will find out that 1.001^5 == 1 / (1 / 1.001^5)
    if squared_base >= result {
        // This inverse the base: 1 / base
        squared_base = u128::MAX.checked_div(squared_base)?;
        // If exponent is negative, the above already inverted the result. Therefore, at the end of the function, we do not need to invert again.
        invert = !invert;
    }

    // The following code is equivalent to looping through each binary value of the exponential.
    // As explained in MAX_EXPONENTIAL, 19 exponential bits are enough to covert the full bin price.
    // Therefore, there will be 19 if statements, which similar to the following pseudo code.
    /*
        let mut result = 1;
        while exponential > 0 {
            if exponential & 1 > 0 {
                result *= base;
            }
            base *= base;
            exponential >>= 1;
        }
    */

    // From right to left
    // squared_base = 1 * base^1
    // 1st bit is 1
    if exp & 0x1 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    // squared_base = base^2
    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    // 2nd bit is 1
    if exp & 0x2 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    // Example:
    // If the base is 1.001, exponential is 3. Binary form of 3 is ..0011. The last 2 1's bit fulfill the above 2 bitwise condition.
    // The result will be 1 * base^1 * base^2 == base^3. The process continues until reach the 20th bit

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x4 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x8 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x10 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x20 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x40 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x80 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x100 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x200 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x400 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x800 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x1000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x2000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x4000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x8000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x10000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x20000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    squared_base = (squared_base.checked_mul(squared_base)?) >> SCALE_OFFSET;
    if exp & 0x40000 > 0 {
        result = (result.checked_mul(squared_base)?) >> SCALE_OFFSET
    }

    // Stop here as the next is 20th bit, which > MAX_EXPONENTIAL
    if result == 0 {
        return None;
    }

    if invert {
        result = u128::MAX.checked_div(result)?;
    }

    Some(result)
}

// Helper function to convert fixed point number to decimal with 10^12 precision. Decimal form is not being used in program, it's only for UI purpose.
pub fn to_decimal(value: u128) -> Option<u128> {
    let value = U256::from(value);
    let precision = U256::from(PRECISION);
    let scaled_value = value.checked_mul(precision)?;
    // ruint checked math is different with the rust std u128. If there's bit with 1 value being shifted out, it will return None. Therefore, we use overflowing_shr
    let (scaled_down_value, _) = scaled_value.overflowing_shr(SCALE_OFFSET.into());
    scaled_down_value.try_into().ok()
}

// Helper function to convert decimal with 10^12 precision to fixed point number
pub fn from_decimal(value: u128) -> Option<u128> {
    let value = U256::from(value);
    let precision = U256::from(PRECISION);
    let (q_value, _) = value.overflowing_shl(SCALE_OFFSET.into());
    let fp_value = q_value.checked_div(precision)?;
    fp_value.try_into().ok()
}

// Helper function to get the base for price calculation. Eg: 1.001 in 64x64 representation
pub fn get_base(bin_step: u32) -> Option<u128> {
    let quotient = u128::from(bin_step).checked_shl(SCALE_OFFSET.into())?;
    let fraction = quotient.checked_div(BASIS_POINT_MAX as u128)?;
    ONE.checked_add(fraction)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BITS_SUPPORTED: u32 = 64;
    const SCALE_OFFSET_F: f64 = 18446744073709551616f64;

    // Get maximum number of bins supported based on BPS and the bits used in u64xu64 math.
    // With some bin_step, the range might be smaller due to underflow in pow
    // (1 + bps)^n <= u64::MAX, solve for n
    fn get_supported_bins(bin_step: u32) -> (i32, i32) {
        let base = 1.0f64 + (bin_step as f64 / BASIS_POINT_MAX as f64);
        let max_price_supported = 2.0f64.powi(BITS_SUPPORTED as i32);
        let n = (max_price_supported.log10() / base.log10()) as i32;
        (-n, n)
    }

    // Because of pow underflow, the supported range will be smaller than what returned from get_supported_bins. This function search for the actual supported range.
    fn find_actual_supported_bins(base: u128, bin_step: u32) -> (i32, i32) {
        let (mut min_bin_id, mut max_bin_id) = get_supported_bins(bin_step);
        // Try pow and check whether underflow happens
        while pow(base, min_bin_id).is_none() {
            min_bin_id = min_bin_id + 1;
        }
        while pow(base, max_bin_id).is_none() {
            max_bin_id = max_bin_id - 1;
        }

        (min_bin_id, max_bin_id)
    }

    // Because of pow behavior of lossy, at the edge of the bin, crossing bin doesn't change price at all. This function find the min and max bin id when crossing bin price changes stopped.
    fn find_actual_bin_cross_with_price_changes(base: u128) -> (i32, i32) {
        let mut bin_id = 0;
        // Crossing towards right
        loop {
            let cur_answer = pow(base, bin_id);
            let next_answer = pow(base, bin_id + 1);
            match next_answer {
                Some(next) => {
                    if cur_answer.unwrap() == next {
                        break;
                    }
                }
                None => {
                    break;
                }
            }
            bin_id = bin_id + 1;
        }
        let max_bin_id = bin_id;
        // Crossing towards left
        loop {
            let cur_answer = pow(base, bin_id);
            let next_answer = pow(base, bin_id - 1);
            match next_answer {
                Some(next) => {
                    if cur_answer.unwrap() == next {
                        break;
                    }
                }
                None => {
                    break;
                }
            }
            bin_id = bin_id - 1;
        }
        let min_bin_id = bin_id;

        (min_bin_id, max_bin_id)
    }

    #[test]
    fn test_get_base_with_valid_bin_step() {
        for bin_step in 1..=10_000u32 {
            let base = get_base(bin_step);
            assert!(base.is_some());

            let dec_base = to_decimal(base.unwrap()).unwrap();
            let f_base = dec_base as f64 / PRECISION as f64;
            let expected_f_base = 1.0f64 + bin_step as f64 / BASIS_POINT_MAX as f64;
            let diff = expected_f_base - f_base;

            assert!(diff < 0.00001f64);
        }
    }

    #[test]
    fn test_find_actual_bin_cross_with_price_changes() {
        for bin_step in 1..=10_000u32 {
            let base = get_base(bin_step);
            assert!(base.is_some());

            let (supported_min_bin_id, supported_max_bin_id) =
                find_actual_supported_bins(base.unwrap(), bin_step);
            let (crossable_min_bin_id, crossable_max_bin_id) =
                find_actual_bin_cross_with_price_changes(base.unwrap());

            assert!(crossable_max_bin_id <= supported_max_bin_id);
            assert!(crossable_min_bin_id >= supported_min_bin_id);

            let mut prev_answer: Option<u128> = None;
            for bin_id in crossable_min_bin_id..=crossable_max_bin_id {
                let answer = pow(base.unwrap(), bin_id);
                assert!(answer.is_some());
                assert!(answer > Some(0));

                if prev_answer.is_some() {
                    let p_answer = prev_answer.unwrap();
                    assert!(p_answer < answer.unwrap());
                }

                prev_answer = answer;
            }
        }
    }

    #[test]
    fn test_supported_min_max_bin_ids_for_bin_step() {
        for bin_step in 1..=10_000u32 {
            let base = get_base(bin_step);
            assert!(base.is_some());

            let (min_bin_id, max_bin_id) = find_actual_supported_bins(base.unwrap(), bin_step);
            for bin_id in min_bin_id..=max_bin_id {
                let answer = pow(base.unwrap(), bin_id);
                assert!(answer.is_some());
                assert!(answer > Some(0));
            }
        }
    }

    #[test]
    fn test_actual_max_supported_bins() {
        for bin_step in 1..=10_000u32 {
            let base = get_base(bin_step);
            assert!(base.is_some());

            let (min_bin_id, max_bin_id) = get_supported_bins(bin_step);
            let (actual_min_bin_id, actual_max_bin_id) =
                find_actual_supported_bins(base.unwrap(), bin_step);

            // Because of pow underflow, some bin_step might results in smaller range
            assert!(actual_min_bin_id >= min_bin_id);
            assert!(actual_max_bin_id <= max_bin_id);
        }
    }

    #[test]
    fn test_max_supported_bins() {
        let bin_steps = [1, 2, 5, 10, 15, 20, 25, 50, 100, 10000];
        let expected_min_max = [
            (-443636, 443636),
            (-221829, 221829),
            (-88745, 88745),
            (-44383, 44383),
            (-29596, 29596),
            (-22202, 22202),
            (-17766, 17766),
            (-8894, 8894),
            (-4458, 4458),
            (-64, 64),
        ];
        for (idx, bin_step) in bin_steps.iter().enumerate() {
            let (min, max) = get_supported_bins(*bin_step);
            let (e_min, e_max) = expected_min_max[idx];
            assert_eq!(max, e_max);
            assert_eq!(min, e_min);
        }
    }

    #[test]
    fn test_pow() {
        let bin_step = 15;
        let bin_id = 3333;
        let base = get_base(bin_step);
        assert!(base.is_some());

        let price = pow(base.unwrap(), bin_id);
        assert!(price.is_some());
        assert!(price == Some(2726140093009341558707u128));

        let price_f = price.unwrap() as f64 / SCALE_OFFSET_F;
        assert!(price_f == 147.78435056702816f64);
    }
}
