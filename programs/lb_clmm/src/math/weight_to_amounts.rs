use crate::errors::LBError;
use crate::math::price_math::get_price_from_id;
use crate::math::safe_math::SafeMath;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::math::utils_math::safe_mul_div_cast_from_u256_to_u64;
use crate::math::utils_math::safe_mul_div_cast_from_u64_to_u64;
use anchor_lang::prelude::*;
use ruint::aliases::U256;

#[derive(Debug, Clone, Copy)]
pub struct AmountInBinSingleSide {
    pub bin_id: i32,
    pub amount: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct AmountInBin {
    pub bin_id: i32,
    pub amount_x: u64,
    pub amount_y: u64,
}

pub fn to_amount_bid_side(
    active_id: i32,
    amount: u64,
    weights: &[(i32, u16)],
) -> Result<Vec<AmountInBinSingleSide>> {
    // get sum of weight
    let mut total_weight = 0u64;
    for &(bin_id, weight) in weights.iter() {
        // skip all ask side
        if bin_id > active_id {
            // break because bin_id is in ascending order
            break;
        }
        total_weight = total_weight.safe_add(weight.into())?;
    }
    if total_weight == 0 {
        return Err(LBError::InvalidInput.into());
    }
    let mut amounts = vec![];
    for &(bin_id, weight) in weights.iter() {
        // skip all ask side
        if bin_id > active_id {
            amounts.push(AmountInBinSingleSide { bin_id, amount: 0 });
        } else {
            amounts.push(AmountInBinSingleSide {
                bin_id,
                amount: safe_mul_div_cast_from_u64_to_u64(weight.into(), amount, total_weight)?,
            });
        }
    }
    Ok(amounts)
}

pub fn to_amount_ask_side(
    active_id: i32,
    amount: u64,
    bin_step: u16,
    weights: &[(i32, u16)],
) -> Result<Vec<AmountInBinSingleSide>> {
    // get sum of weight
    let mut total_weight = U256::ZERO;
    let mut weight_per_prices = vec![U256::ZERO; weights.len()];
    for (i, &(bin_id, weight)) in weights.iter().enumerate() {
        // skip all bid side
        if bin_id < active_id {
            continue;
        }
        let weight_per_price = U256::from(weight)
            .safe_shl((SCALE_OFFSET * 2).into())?
            .safe_div(U256::from(get_price_from_id(bin_id, bin_step)?))?;
        weight_per_prices[i] = weight_per_price;
        total_weight = total_weight.safe_add(weight_per_price)?;
    }

    if total_weight == U256::ZERO {
        return Err(LBError::InvalidInput.into());
    }

    let mut amounts = vec![];
    for (i, &(bin_id, _weight)) in weights.iter().enumerate() {
        // skip all bid side
        if bin_id < active_id {
            amounts.push(AmountInBinSingleSide { bin_id, amount: 0 });
        } else {
            amounts.push(AmountInBinSingleSide {
                bin_id,
                amount: safe_mul_div_cast_from_u256_to_u64(
                    amount,
                    weight_per_prices[i],
                    total_weight,
                )?,
            });
        }
    }
    Ok(amounts)
}

fn get_active_bin_index(active_id: i32, weights: &[(i32, u16)]) -> Option<usize> {
    for (i, &(bin_id, _weight)) in weights.iter().enumerate() {
        if bin_id == active_id {
            return Some(i);
        }
        // bin_id is sorted, so no need to check if bin cross
        if bin_id > active_id {
            break;
        }
    }
    return None;
}

pub fn to_amount_both_side(
    active_id: i32,
    bin_step: u16,
    amount_x: u64, // amount_x in active bin
    amount_y: u64, // amount_y in active bin
    total_amount_x: u64,
    total_amount_y: u64,
    weights: &[(i32, u16)],
) -> Result<Vec<AmountInBin>> {
    // only bid side
    if active_id > weights[weights.len() - 1].0 {
        let amounts = to_amount_bid_side(active_id, total_amount_y, weights)?;

        let amounts = amounts
            .iter()
            .map(|x| AmountInBin {
                bin_id: x.bin_id,
                amount_x: 0,
                amount_y: x.amount,
            })
            .collect::<Vec<AmountInBin>>();

        return Ok(amounts);
    }
    // only ask side
    if active_id < weights[0].0 {
        let amounts = to_amount_ask_side(active_id, total_amount_x, bin_step, weights)?;

        let amounts = amounts
            .iter()
            .map(|x| AmountInBin {
                bin_id: x.bin_id,
                amount_x: x.amount,
                amount_y: 0,
            })
            .collect::<Vec<AmountInBin>>();

        return Ok(amounts);
    }
    match get_active_bin_index(active_id, weights) {
        Some(index) => {
            let (active_bin_id, active_weight) = weights[index];
            let p0 = U256::from(get_price_from_id(active_bin_id, bin_step)?);

            let (wx0, wy0) = if amount_x == 0 && amount_y == 0 {
                // equal ratio if both amount_x and amount_y is zero
                let wx0 = U256::from(active_weight)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(p0.safe_mul(U256::from(2))?)?;

                let wy0 = U256::from(active_weight)
                    .safe_shl(SCALE_OFFSET.into())?
                    .safe_div(U256::from(2))?;
                (wx0, wy0)
            } else {
                let wx0 = if amount_x == 0 {
                    U256::ZERO
                } else {
                    U256::from(active_weight)
                        .safe_shl((SCALE_OFFSET * 2).into())?
                        .safe_div(
                            p0.safe_add(
                                U256::from(amount_y)
                                    .safe_shl(SCALE_OFFSET.into())?
                                    .safe_div(U256::from(amount_x))?,
                            )?,
                        )?
                };
                let wy0 = if amount_y == 0 {
                    U256::ZERO
                } else {
                    U256::from(active_weight)
                        .safe_shl((SCALE_OFFSET * 2).into())?
                        .safe_div(
                            U256::from(1).safe_shl(SCALE_OFFSET.into())?.safe_add(
                                p0.safe_mul(U256::from(amount_x))?
                                    .safe_div(U256::from(amount_y))?,
                            )?,
                        )?
                };
                (wx0, wy0)
            };

            let mut total_weight_x = wx0;
            let mut total_weight_y = wy0;
            let mut weight_per_prices = vec![U256::ZERO; weights.len()];
            for (i, &(bin_id, weight)) in weights.iter().enumerate() {
                if bin_id < active_id {
                    total_weight_y = total_weight_y
                        .safe_add(U256::from(weight).safe_shl(SCALE_OFFSET.into())?)?;
                    continue;
                }
                if bin_id > active_id {
                    let weight_per_price = U256::from(weight)
                        .safe_shl((SCALE_OFFSET * 2).into())?
                        .safe_div(U256::from(get_price_from_id(bin_id, bin_step)?))?;
                    weight_per_prices[i] = weight_per_price;
                    total_weight_x = total_weight_x.safe_add(weight_per_price)?;
                    continue;
                }
            }
            // find k
            let ky = U256::from(total_amount_y)
                .safe_shl((SCALE_OFFSET * 2).into())?
                .safe_div(total_weight_y)?;

            let kx = U256::from(total_amount_x)
                .safe_shl((SCALE_OFFSET * 2).into())?
                .safe_div(total_weight_x)?;
            let k = kx.min(ky);
            let mut amounts = vec![];
            for (i, &(bin_id, weight)) in weights.iter().enumerate() {
                if bin_id < active_id {
                    let (amount_y_in_bin, _) = k
                        .safe_mul(U256::from(weight))?
                        .overflowing_shr(SCALE_OFFSET.into());
                    amounts.push(AmountInBin {
                        bin_id,
                        amount_x: 0,
                        amount_y: u64::try_from(amount_y_in_bin)
                            .map_err(|_| LBError::TypeCastFailed)?,
                    });
                    continue;
                }
                if bin_id > active_id {
                    let (amount_x_in_bin, _) = k
                        .safe_mul(weight_per_prices[i])?
                        .overflowing_shr((SCALE_OFFSET * 2).into());

                    amounts.push(AmountInBin {
                        bin_id,
                        amount_x: u64::try_from(amount_x_in_bin)
                            .map_err(|_| LBError::TypeCastFailed)?,
                        amount_y: 0,
                    });
                    continue;
                }
                // else we are in active id
                let (amount_x_in_bin, _) =
                    k.safe_mul(wx0)?.overflowing_shr((SCALE_OFFSET * 2).into());
                let (amount_y_in_bin, _) =
                    k.safe_mul(wy0)?.overflowing_shr((SCALE_OFFSET * 2).into());

                amounts.push(AmountInBin {
                    bin_id,
                    amount_x: u64::try_from(amount_x_in_bin)
                        .map_err(|_| LBError::TypeCastFailed)?,
                    amount_y: u64::try_from(amount_y_in_bin)
                        .map_err(|_| LBError::TypeCastFailed)?,
                });
            }
            return Ok(amounts);
        }
        None => {
            let mut total_weight_x = U256::ZERO;
            let mut total_weight_y = U256::ZERO;
            let mut weight_per_prices = vec![U256::ZERO; weights.len()];

            for (i, &(bin_id, weight)) in weights.iter().enumerate() {
                if bin_id < active_id {
                    total_weight_y = total_weight_y
                        .safe_add(U256::from(weight).safe_shl(SCALE_OFFSET.into())?)?;
                    continue;
                }
                if bin_id > active_id {
                    let weight_per_price = U256::from(weight)
                        .safe_shl((SCALE_OFFSET * 2).into())?
                        .safe_div(U256::from(get_price_from_id(bin_id, bin_step)?))?;
                    weight_per_prices[i] = weight_per_price;
                    total_weight_x = total_weight_x.safe_add(weight_per_price)?;
                }
            }
            // find k
            let ky = U256::from(total_amount_y)
                .safe_shl((SCALE_OFFSET * 2).into())?
                .safe_div(total_weight_y)?;

            let kx = U256::from(total_amount_x)
                .safe_shl((SCALE_OFFSET * 2).into())?
                .safe_div(total_weight_x)?;
            let k = kx.min(ky);

            let mut amounts = vec![];
            for (i, &(bin_id, weight)) in weights.iter().enumerate() {
                if bin_id < active_id {
                    let (amount_y_in_bin, _) = k
                        .safe_mul(U256::from(weight))?
                        .overflowing_shr(SCALE_OFFSET.into());
                    amounts.push(AmountInBin {
                        bin_id,
                        amount_x: 0,
                        amount_y: u64::try_from(amount_y_in_bin)
                            .map_err(|_| LBError::TypeCastFailed)?,
                    });
                    continue;
                }
                if bin_id > active_id {
                    let (amount_x_in_bin, _) = k
                        .safe_mul(weight_per_prices[i])?
                        .overflowing_shr((SCALE_OFFSET * 2).into());

                    amounts.push(AmountInBin {
                        bin_id,
                        amount_x: u64::try_from(amount_x_in_bin)
                            .map_err(|_| LBError::TypeCastFailed)?,
                        amount_y: 0,
                    });
                }
            }
            return Ok(amounts);
        }
    }
}

#[cfg(test)]
mod add_liquidity_by_weight_test {
    use crate::constants::tests::PRESET_BIN_STEP;
    use crate::constants::DEFAULT_BIN_PER_POSITION;
    use crate::constants::{MAX_BIN_ID, MIN_BIN_ID};
    use crate::math::u64x64_math::PRECISION;
    use crate::BinLiquidityDistributionByWeight;
    use crate::LiquidityParameterByWeight;

    use super::*;
    use proptest::proptest;

    fn get_supported_bin_range(bin_step: u16) -> Result<(i32, i32)> {
        match bin_step {
            1 => Ok((-100000, 100000)),
            2 => Ok((-80000, 80000)),
            4 => Ok((-65000, 65000)),
            5 => Ok((-60000, 60000)),
            8 => Ok((-40000, 40000)),
            10 => Ok((-20000, 20000)),
            15 => Ok((-18000, 18000)),
            20 => Ok((-16000, 16000)),
            25 => Ok((-14000, 14000)),
            50 => Ok((-7000, 7000)),
            60 => Ok((-5800, 5800)),
            100 => Ok((-2900, 2900)),
            _ => Err(LBError::InvalidInput.into()),
        }
    }

    fn new_liquidity_parameter_from_dist(
        amount_x: u64,
        amount_y: u64,
        bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
    ) -> LiquidityParameterByWeight {
        LiquidityParameterByWeight {
            amount_x,
            amount_y,
            active_id: 0,
            max_active_bin_slippage: i32::MAX,
            bin_liquidity_dist,
        }
    }

    fn get_k(
        bin_id: i32,
        amount_x: u64,
        amount_y: u64,
        bin_step: u16,
        weight: u16,
    ) -> Result<U256> {
        let price = U256::from(get_price_from_id(bin_id, bin_step)?);
        let amount_x = U256::from(amount_x);
        let amount_y = U256::from(amount_y).safe_shl(SCALE_OFFSET.into())?;
        let weight = U256::from(weight);

        let capital = amount_x
            .checked_mul(price)
            .unwrap()
            .checked_add(amount_y)
            .unwrap();

        let k = capital.checked_div(weight).unwrap();

        return Ok(k);
    }

    fn assert_amount_in_active_bin(
        amount_x: u64,
        amount_y: u64,
        amount_x_in_bin: u64,
        amount_y_in_bin: u64,
    ) -> Option<()> {
        if amount_x == 0 && amount_y == 0 {
            return Some(());
        }
        if amount_x == 0 {
            if amount_x_in_bin != 0 {
                return None;
            } else {
                return Some(());
            }
        }
        if amount_y == 0 {
            if amount_y_in_bin != 0 {
                return None;
            } else {
                return Some(());
            }
        }
        if amount_y_in_bin == 0 {
            // TODO fix this assertion
            return Some(());
        }
        let amount_x = u128::from(amount_x);
        let amount_y = u128::from(amount_y);
        let amount_x_in_bin = u128::from(amount_x_in_bin);
        let amount_y_in_bin = u128::from(amount_y_in_bin);

        let r1 = amount_x
            .checked_mul(PRECISION)
            .unwrap()
            .checked_div(amount_y)
            .unwrap();
        let r2 = amount_x_in_bin
            .checked_mul(PRECISION)
            .unwrap()
            .checked_div(amount_y_in_bin)
            .unwrap();

        return assert_same_value_with_precision(U256::from(r1), U256::from(r2), U256::from(100));
    }

    fn assert_same_value_with_precision(k1: U256, k2: U256, multiplier: U256) -> Option<()> {
        // TODO fix this assertion
        if k1 == U256::ZERO && k2 == U256::ZERO {
            return Some(());
        }

        let ratio = if k1 < k2 {
            (k2.checked_sub(k1)?)
                .checked_mul(multiplier)?
                .checked_div(k1)?
        } else {
            (k1.checked_sub(k2)?)
                .checked_mul(multiplier)?
                .checked_div(k2)?
        };
        if ratio != U256::ZERO {
            return None;
        }
        Some(())
    }

    fn assert_in_amounts(
        liquidity_parameter: &LiquidityParameterByWeight,
        in_amounts: &Vec<AmountInBin>,
        active_id: i32,
        amount_x: u64,
        amount_y: u64,
        bin_step: u16,
    ) -> Option<()> {
        let mut sum_x = 0u64;
        let mut sum_y = 0u64;
        for val in in_amounts.iter() {
            sum_x = sum_x.checked_add(val.amount_x)?;
            sum_y = sum_y.checked_add(val.amount_y)?;
        }

        if sum_x > liquidity_parameter.amount_x {
            return None;
        };
        if sum_y > liquidity_parameter.amount_y {
            return None;
        };

        // allow precision, must consume all amounts in 1 side
        let is_x_full = assert_same_value_with_precision(
            U256::from(liquidity_parameter.amount_x),
            U256::from(sum_x),
            U256::from(1000),
        );
        let is_y_full = assert_same_value_with_precision(
            U256::from(liquidity_parameter.amount_y),
            U256::from(sum_y),
            U256::from(1000),
        );
        if is_x_full.is_none() && is_y_full.is_none() {
            return None;
        }

        let weights = liquidity_parameter
            .bin_liquidity_dist
            .iter()
            .map(|x| (x.bin_id, x.weight))
            .collect::<Vec<(i32, u16)>>();

        match get_active_bin_index(active_id, &weights) {
            Some(index) => {
                let ok = assert_amount_in_active_bin(
                    amount_x,
                    amount_y,
                    in_amounts[index].amount_x,
                    in_amounts[index].amount_y,
                );
                if ok.is_none() {
                    println!(
                        "{} {} {} {}",
                        amount_x, amount_y, in_amounts[index].bin_id, in_amounts[index].amount_x
                    );
                    return None;
                }
            }
            None => {}
        }

        // assert distribution
        for i in 0..liquidity_parameter.bin_liquidity_dist.len() {
            let ki = get_k(
                liquidity_parameter.bin_liquidity_dist[i].bin_id,
                in_amounts[i].amount_x,
                in_amounts[i].amount_y,
                bin_step,
                liquidity_parameter.bin_liquidity_dist[i].weight,
            )
            .unwrap();

            for j in (i + 1)..liquidity_parameter.bin_liquidity_dist.len() {
                let kj = get_k(
                    liquidity_parameter.bin_liquidity_dist[j].bin_id,
                    in_amounts[j].amount_x,
                    in_amounts[j].amount_y,
                    bin_step,
                    liquidity_parameter.bin_liquidity_dist[j].weight,
                )
                .unwrap();

                let is_same_ratio = assert_same_value_with_precision(ki, kj, U256::from(100));
                if is_same_ratio.is_none() {
                    println!("k is not equal {} {}", ki, kj);
                    return None;
                }
            }
        }
        Some(())
    }

    #[test]
    fn test_simple_case() {
        let amount_x = 100000;
        let amount_y = 2000000;
        let amount_x_in_active_bin = 100;
        let amount_y_in_active_bin = 2000;

        let bin_step = 10;
        let bin_liquidity_dist = vec![
            BinLiquidityDistributionByWeight {
                bin_id: 1,
                weight: 20,
            },
            BinLiquidityDistributionByWeight {
                bin_id: 3,
                weight: 10,
            },
            BinLiquidityDistributionByWeight {
                bin_id: 5,
                weight: 10,
            },
            BinLiquidityDistributionByWeight {
                bin_id: 7,
                weight: 10,
            },
        ];
        let liquidity_parameter =
            new_liquidity_parameter_from_dist(amount_x, amount_y, bin_liquidity_dist);

        let active_id = 0;
        let in_amounts = liquidity_parameter
            .to_amounts_into_bin(
                active_id,
                bin_step,
                amount_x_in_active_bin,
                amount_y_in_active_bin,
            )
            .unwrap();

        assert_in_amounts(
            &liquidity_parameter,
            &in_amounts,
            active_id,
            amount_x_in_active_bin,
            amount_y_in_active_bin,
            bin_step,
        )
        .unwrap();

        let active_id = 8;
        let in_amounts = liquidity_parameter
            .to_amounts_into_bin(
                active_id,
                bin_step,
                amount_x_in_active_bin,
                amount_y_in_active_bin,
            )
            .unwrap();
        println!("bid side {:?}", in_amounts);

        assert_in_amounts(
            &liquidity_parameter,
            &in_amounts,
            active_id,
            amount_x_in_active_bin,
            amount_y_in_active_bin,
            bin_step,
        )
        .unwrap();

        let active_id = 6;
        let in_amounts = liquidity_parameter
            .to_amounts_into_bin(
                active_id,
                bin_step,
                amount_x_in_active_bin,
                amount_y_in_active_bin,
            )
            .unwrap();
        println!("active id is not existed {:?}", in_amounts);

        assert_in_amounts(
            &liquidity_parameter,
            &in_amounts,
            active_id,
            amount_x_in_active_bin,
            amount_y_in_active_bin,
            bin_step,
        )
        .unwrap();

        let active_id = 5;
        let in_amounts = liquidity_parameter
            .to_amounts_into_bin(
                active_id,
                bin_step,
                amount_x_in_active_bin,
                amount_y_in_active_bin,
            )
            .unwrap();
        println!("active id is existed {:?}", in_amounts);

        assert_in_amounts(
            &liquidity_parameter,
            &in_amounts,
            active_id,
            amount_x_in_active_bin,
            amount_y_in_active_bin,
            bin_step,
        )
        .unwrap();
    }

    fn new_liquidity_parameter(
        amount_x: u64,
        amount_y: u64,
        active_id: i32,
        num_bin: usize,
        side_type: u16,
    ) -> LiquidityParameterByWeight {
        if side_type == 0 {
            // ask side
            let mut bin_liquidity_dist = vec![];
            for i in 0..num_bin {
                bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                    bin_id: active_id + (i as i32) + 1,
                    weight: u16::MAX,
                })
            }

            return LiquidityParameterByWeight {
                amount_x,
                amount_y,
                active_id,
                max_active_bin_slippage: i32::MAX,
                bin_liquidity_dist,
            };
        }
        if side_type == 1 {
            // bid side
            let mut bin_liquidity_dist = vec![];
            for i in 0..num_bin {
                bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                    bin_id: active_id - ((i as i32) + 1),
                    weight: u16::MAX,
                })
            }

            return LiquidityParameterByWeight {
                amount_x,
                amount_y,
                active_id,
                max_active_bin_slippage: i32::MAX,
                bin_liquidity_dist,
            };
        }
        if side_type == 2 {
            // active id is not existed
            let mut bin_liquidity_dist = vec![];
            for i in 0..num_bin {
                let bin_id = active_id + ((i as i32) + 1) - (num_bin as i32 / 2);
                if bin_id == active_id {
                    continue;
                }
                bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                    bin_id: bin_id,
                    weight: u16::MAX,
                })
            }

            return LiquidityParameterByWeight {
                amount_x,
                amount_y,
                active_id,
                max_active_bin_slippage: i32::MAX,
                bin_liquidity_dist,
            };
        }

        if side_type == 3 {
            // active id is existed
            let mut bin_liquidity_dist = vec![];
            for i in 0..num_bin {
                let bin_id = active_id + ((i as i32) + 1) - (num_bin as i32 / 2);
                bin_liquidity_dist.push(BinLiquidityDistributionByWeight {
                    bin_id: bin_id,
                    weight: u16::MAX,
                })
            }

            return LiquidityParameterByWeight {
                amount_x,
                amount_y,
                active_id,
                max_active_bin_slippage: i32::MAX,
                bin_liquidity_dist,
            };
        }
        panic!("not supported");
    }

    #[test]
    fn test_debug() {
        let amount_x = 2554236866980533123;
        let amount_y = 169441449402218619;
        let amount_x_in_active_bin = 1691977113496464004;
        let amount_y_in_active_bin = 2495859837519749078;
        let active_id = -4007;
        let num_bin = 49;
        let bin_step = 100;
        let side_type = 2;
        let liquidity_parameter =
            new_liquidity_parameter(amount_x, amount_y, active_id, num_bin, side_type);
        let in_amounts = liquidity_parameter.to_amounts_into_bin(
            active_id,
            bin_step,
            amount_x_in_active_bin,
            amount_y_in_active_bin,
        );
        println!("{:?}", in_amounts);
    }

    proptest! {
        #[test]
        fn test_in_amounts(
            amount_x in 0..u64::MAX / 4,
            amount_y in 0..u64::MAX / 4,
            amount_x_in_active_bin in 0..u64::MAX/ 4,
            amount_y_in_active_bin in 0..u64::MAX/ 4,
            active_id in MIN_BIN_ID..=MAX_BIN_ID,
            num_bin in 1..DEFAULT_BIN_PER_POSITION,
            side_type in 0..4u16,

        ){
            if side_type == 2 || side_type == 3 {
                if num_bin < 3 {
                    return Ok(());
                }
            }
            for &bin_step in PRESET_BIN_STEP.iter(){
                let (min_bin_id, max_bin_id) = get_supported_bin_range(bin_step).unwrap();
                if active_id < min_bin_id || active_id > max_bin_id {
                    continue;
                }
                let liquidity_parameter = new_liquidity_parameter(amount_x, amount_y, active_id, num_bin, side_type);
                if !liquidity_parameter.validate(active_id).is_err() {
                    match liquidity_parameter
                    .to_amounts_into_bin(
                        active_id,
                        bin_step,
                        amount_x_in_active_bin,
                        amount_y_in_active_bin,
                    ) {
                        Ok(in_amounts) => {
                            let is_ok = assert_in_amounts(
                                &liquidity_parameter,
                                &in_amounts,
                                active_id,
                                amount_x_in_active_bin,
                                amount_y_in_active_bin,
                                bin_step,
                            );
                            if is_ok.is_none() {
                                println!("failed case {} {} {} {} {} {} {} {}", amount_x, amount_y, amount_x_in_active_bin, amount_y_in_active_bin, active_id, num_bin, bin_step, side_type);
                                assert!(false);
                            }
                        }
                        Err(_err) => {
                            println!("overflow case {} {} {} {} {} {} {} {}", amount_x, amount_y, amount_x_in_active_bin, amount_y_in_active_bin, active_id, num_bin,bin_step, side_type);
                            assert!(false);
                        }
                    }
                }
            }
        }
    }
}
