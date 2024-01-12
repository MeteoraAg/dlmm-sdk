use crate::constants::MAX_BIN_PER_POSITION;
use crate::errors::LBError;
use crate::math::price_math::get_price_from_id;
use crate::math::safe_math::SafeMath;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::math::utils_math::{
    safe_mul_div_cast_from_u256_to_u64, safe_mul_div_cast_from_u64_to_u64,
};
use crate::ModifyLiquidity;
use anchor_lang::prelude::*;
use ruint::aliases::U256;

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct BinLiquidityDistributionByWeight {
    /// Define the bin ID wish to deposit to.
    pub bin_id: i32,
    /// weight of liquidity distributed for this bin id
    pub weight: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityParameterByWeight {
    /// Amount of X token to deposit
    pub amount_x: u64,
    /// Amount of Y token to deposit
    pub amount_y: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
}

impl LiquidityParameterByWeight {
    fn bin_count(&self) -> u32 {
        self.bin_liquidity_dist.len() as u32
    }

    fn validate<'a, 'info>(&'a self, active_id: i32) -> Result<()> {
        let bin_count = self.bin_count();
        require!(bin_count > 0, LBError::InvalidInput);

        require!(
            bin_count <= MAX_BIN_PER_POSITION as u32,
            LBError::InvalidInput
        );

        let bin_shift = if active_id > self.active_id {
            active_id - self.active_id
        } else {
            self.active_id - active_id
        };

        require!(
            bin_shift <= self.max_active_bin_slippage.into(),
            LBError::ExceededBinSlippageTolerance
        );

        // bin dist must be in consecutive order and weight is non-zero
        for (i, val) in self.bin_liquidity_dist.iter().enumerate() {
            require!(val.weight != 0, LBError::InvalidInput);
            // bin id must in right order
            if i != 0 {
                require!(
                    val.bin_id > self.bin_liquidity_dist[i - 1].bin_id,
                    LBError::InvalidInput
                );
            }
        }
        let first_bin_id = self.bin_liquidity_dist[0].bin_id;
        let last_bin_id = self.bin_liquidity_dist[self.bin_liquidity_dist.len() - 1].bin_id;

        if first_bin_id > active_id {
            require!(self.amount_x != 0, LBError::InvalidInput);
        }
        if last_bin_id < active_id {
            require!(self.amount_y != 0, LBError::InvalidInput);
        }

        Ok(())
    }

    fn get_active_bin_index(&self, active_id: i32) -> Option<usize> {
        for (i, val) in self.bin_liquidity_dist.iter().enumerate() {
            if val.bin_id == active_id {
                return Some(i);
            }
            // bin_id is sorted, so no need to check if bin cross
            if val.bin_id > active_id {
                break;
            }
        }
        return None;
    }

    // require bin id to be sorted before doing this
    pub fn to_amounts_into_bin<'a, 'info>(
        &'a self,
        active_id: i32,
        bin_step: u16,
        amount_x: u64, // amount x in active bin
        amount_y: u64, // amount y in active bin
    ) -> Result<Vec<(u64, u64)>> {
        // only bid side
        if active_id > self.bin_liquidity_dist[self.bin_liquidity_dist.len() - 1].bin_id {
            // get sum of weight
            let mut total_weight = 0u64;
            for dist in self.bin_liquidity_dist.iter() {
                total_weight = total_weight.safe_add(dist.weight.into())?;
            }
            let mut amounts = vec![];
            for dist in self.bin_liquidity_dist.iter() {
                amounts.push((
                    0,
                    safe_mul_div_cast_from_u64_to_u64(
                        dist.weight.into(),
                        self.amount_y,
                        total_weight,
                    )?,
                ));
            }
            return Ok(amounts);
        }
        // only ask side
        if active_id < self.bin_liquidity_dist[0].bin_id {
            // get sum of weight
            let mut total_weight = U256::ZERO;
            let mut weight_per_prices = vec![U256::ZERO; self.bin_liquidity_dist.len()];
            for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                let weight_per_price = U256::from(dist.weight)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(U256::from(get_price_from_id(dist.bin_id, bin_step)?))?;
                weight_per_prices[i] = weight_per_price;
                total_weight = total_weight.safe_add(weight_per_price)?;
            }

            let mut amounts = vec![];
            for &weight_per_price in weight_per_prices.iter() {
                amounts.push((
                    safe_mul_div_cast_from_u256_to_u64(
                        self.amount_x,
                        weight_per_price,
                        total_weight,
                    )?,
                    0,
                ));
            }
            return Ok(amounts);
        }

        match self.get_active_bin_index(active_id) {
            Some(index) => {
                let active_bin = &self.bin_liquidity_dist[index];
                let p0 = U256::from(get_price_from_id(active_bin.bin_id, bin_step)?);

                let (wx0, wy0) = if amount_x == 0 && amount_y == 0 {
                    // equal ratio if both amount_x and amount_y is zero
                    let wx0 = U256::from(active_bin.weight)
                        .safe_shl((SCALE_OFFSET * 2).into())?
                        .safe_div(p0.safe_mul(U256::from(2))?)?;

                    let wy0 = U256::from(active_bin.weight)
                        .safe_shl(SCALE_OFFSET.into())?
                        .safe_div(U256::from(2))?;
                    (wx0, wy0)
                } else {
                    let wx0 = if amount_x == 0 {
                        U256::ZERO
                    } else {
                        U256::from(active_bin.weight)
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
                        U256::from(active_bin.weight)
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
                let mut weight_per_prices = vec![U256::ZERO; self.bin_liquidity_dist.len()];
                for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                    if dist.bin_id < active_id {
                        total_weight_y = total_weight_y
                            .safe_add(U256::from(dist.weight).safe_shl(SCALE_OFFSET.into())?)?;
                        continue;
                    }
                    if dist.bin_id > active_id {
                        let weight_per_price = U256::from(dist.weight)
                            .safe_shl((SCALE_OFFSET * 2).into())?
                            .safe_div(U256::from(get_price_from_id(dist.bin_id, bin_step)?))?;
                        weight_per_prices[i] = weight_per_price;
                        total_weight_x = total_weight_x.safe_add(weight_per_price)?;
                        continue;
                    }
                }
                // find k
                let ky = U256::from(self.amount_y)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(total_weight_y)?;

                let kx = U256::from(self.amount_x)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(total_weight_x)?;
                let k = kx.min(ky);
                let mut amounts = vec![];
                for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                    if dist.bin_id < active_id {
                        let (amount_y_in_bin, _) = k
                            .safe_mul(U256::from(dist.weight))?
                            .overflowing_shr(SCALE_OFFSET.into());
                        amounts.push((
                            0,
                            u64::try_from(amount_y_in_bin).map_err(|_| LBError::TypeCastFailed)?,
                        ));
                        continue;
                    }
                    if dist.bin_id > active_id {
                        let (amount_x_in_bin, _) = k
                            .safe_mul(weight_per_prices[i])?
                            .overflowing_shr((SCALE_OFFSET * 2).into());

                        amounts.push((
                            u64::try_from(amount_x_in_bin).map_err(|_| LBError::TypeCastFailed)?,
                            0,
                        ));
                        continue;
                    }
                    // else we are in active id
                    let (amount_x_in_bin, _) =
                        k.safe_mul(wx0)?.overflowing_shr((SCALE_OFFSET * 2).into());
                    let (amount_y_in_bin, _) =
                        k.safe_mul(wy0)?.overflowing_shr((SCALE_OFFSET * 2).into());

                    amounts.push((
                        u64::try_from(amount_x_in_bin).map_err(|_| LBError::TypeCastFailed)?,
                        u64::try_from(amount_y_in_bin).map_err(|_| LBError::TypeCastFailed)?,
                    ));
                }
                return Ok(amounts);
            }
            None => {
                let mut total_weight_x = U256::ZERO;
                let mut total_weight_y = U256::ZERO;
                let mut weight_per_prices = vec![U256::ZERO; self.bin_liquidity_dist.len()];

                for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                    if dist.bin_id < active_id {
                        total_weight_y = total_weight_y
                            .safe_add(U256::from(dist.weight).safe_shl(SCALE_OFFSET.into())?)?;
                        continue;
                    }
                    if dist.bin_id > active_id {
                        let weight_per_price = U256::from(dist.weight)
                            .safe_shl((SCALE_OFFSET * 2).into())?
                            .safe_div(U256::from(get_price_from_id(dist.bin_id, bin_step)?))?;
                        weight_per_prices[i] = weight_per_price;
                        total_weight_x = total_weight_x.safe_add(weight_per_price)?;
                    }
                }
                // find k
                let ky = U256::from(self.amount_y)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(total_weight_y)?;

                let kx = U256::from(self.amount_x)
                    .safe_shl((SCALE_OFFSET * 2).into())?
                    .safe_div(total_weight_x)?;
                let k = kx.min(ky);

                let mut amounts = vec![];
                for (i, dist) in self.bin_liquidity_dist.iter().enumerate() {
                    if dist.bin_id < active_id {
                        let (amount_y_in_bin, _) = k
                            .safe_mul(U256::from(dist.weight))?
                            .overflowing_shr(SCALE_OFFSET.into());
                        amounts.push((
                            0,
                            u64::try_from(amount_y_in_bin).map_err(|_| LBError::TypeCastFailed)?,
                        ));
                        continue;
                    }
                    if dist.bin_id > active_id {
                        let (amount_x_in_bin, _) = k
                            .safe_mul(weight_per_prices[i])?
                            .overflowing_shr((SCALE_OFFSET * 2).into());

                        amounts.push((
                            u64::try_from(amount_x_in_bin).map_err(|_| LBError::TypeCastFailed)?,
                            0,
                        ));
                    }
                }
                return Ok(amounts);
            }
        }
    }
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    liquidity_parameter: &LiquidityParameterByWeight,
) -> Result<()> {
    Ok(())
}
