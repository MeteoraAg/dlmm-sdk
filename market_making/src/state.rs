use crate::bin_array_manager::BinArrayManager;
use crate::pair_config::PairConfig;
use anchor_lang::prelude::Pubkey;
use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::math::price_math::get_price_from_id;
use lb_clmm::math::safe_math::SafeMath;
use lb_clmm::math::u64x64_math::to_decimal;
use lb_clmm::math::u64x64_math::PRECISION;
use lb_clmm::state::bin::Bin;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::str::FromStr;

pub struct AllPosition {
    pub all_positions: HashMap<Pubkey, SinglePosition>, // hashmap of pool pubkey and a position
    pub tokens: HashMap<Pubkey, Mint>,                  // cached token info
}

impl AllPosition {
    pub fn new(config: &Vec<PairConfig>) -> Self {
        let mut all_positions = HashMap::new();
        for pair in config.iter() {
            let pool_pk = Pubkey::from_str(&pair.pair_address).unwrap();
            all_positions.insert(pool_pk, SinglePosition::new(pool_pk));
        }
        AllPosition {
            all_positions,
            tokens: HashMap::new(),
        }
    }
}

#[derive(Default, Debug, Clone)]
pub struct SinglePosition {
    pub lb_pair: Pubkey,
    pub lb_pair_state: LbPair,
    pub bin_arrays: HashMap<Pubkey, BinArray>, // only store relevant bin arrays
    pub positions: Vec<PositionV2>,
    pub position_pks: Vec<Pubkey>,
    pub rebalance_time: u64,
    pub min_bin_id: i32,
    pub max_bin_id: i32,
    pub last_update_timestamp: u64,
}

const SLIPPAGE_RATE: u64 = 300; // 3%
const BASIC_POINT_MAX: u64 = 10_000;

impl SinglePosition {
    pub fn inc_rebalance_time(&mut self) {
        self.rebalance_time += 1;
    }
    pub fn get_min_out_amount_with_slippage_rate(
        &self,
        amount_in: u64,
        swap_for_y: bool,
    ) -> Result<u64> {
        let lb_pair_state = self.lb_pair_state;
        let price = get_price_from_id(lb_pair_state.active_id, lb_pair_state.bin_step)?;
        let out_amount = Bin::get_amount_out(amount_in, price, swap_for_y)?;

        let min_out_amount = out_amount
            .checked_mul(BASIC_POINT_MAX - SLIPPAGE_RATE)
            .unwrap()
            .checked_div(BASIC_POINT_MAX)
            .unwrap();
        Ok(min_out_amount)
    }
    pub fn get_positions(&self) -> Result<PositionRaw> {
        if self.positions.len() == 0 {
            return Ok(PositionRaw::default());
        }
        let mut amount_x = 0u64;
        let mut amount_y = 0u64;
        let mut fee_x = 0u64;
        let mut fee_y = 0u64;
        for position in self.positions.iter() {
            let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(position.lower_bin_id)?;
            let upper_bin_array_idx = lower_bin_array_idx.checked_add(1).context("MathOverflow")?;
            let mut bin_arrays = vec![];
            for i in lower_bin_array_idx..=upper_bin_array_idx {
                let (bin_array_pk, _bump) = pda::derive_bin_array_pda(self.lb_pair, i.into());

                let bin_array_state = self
                    .bin_arrays
                    .get(&bin_array_pk)
                    .ok_or(Error::msg("Cannot get binarray"))?;
                bin_arrays.push(*bin_array_state);
            }
            let bin_array_manager = BinArrayManager {
                bin_arrays: &bin_arrays,
            };

            for (i, &share) in position.liquidity_shares.iter().enumerate() {
                if share == 0 {
                    continue;
                }

                let bin_id = position.from_idx_to_bin_id(i)?;
                let bin = bin_array_manager.get_bin(bin_id)?;
                let (bin_amount_x, bin_amount_y) = bin.calculate_out_amount(share)?;
                amount_x = amount_x
                    .safe_add(bin_amount_x)
                    .map_err(|_| Error::msg("Math is overflow"))?;
                amount_y = amount_y
                    .safe_add(bin_amount_y)
                    .map_err(|_| Error::msg("Math is overflow"))?;

                // println!("bin: {bin_id} amount_x: {amount_x} amount_y: {amount_y}");
            }

            let (fee_x_pending, fee_y_pending) =
                bin_array_manager.get_total_fee_pending(position)?;
            fee_x = fee_x
                .safe_add(fee_x_pending)
                .map_err(|_| Error::msg("Math is overflow"))?;
            fee_y = fee_y
                .safe_add(fee_y_pending)
                .map_err(|_| Error::msg("Math is overflow"))?;
        }

        return Ok(PositionRaw {
            position_len: self.positions.len(),
            bin_step: self.lb_pair_state.bin_step,
            rebalance_time: self.rebalance_time,
            min_bin_id: self.min_bin_id,
            active_id: self.lb_pair_state.active_id,
            max_bin_id: self.max_bin_id,
            amount_x,
            amount_y,
            fee_x,
            fee_y,
            last_update_timestamp: self.last_update_timestamp,
        });
    }
}

#[derive(Default, PartialEq, Debug, Clone, Serialize, Deserialize)]
pub struct PositionRaw {
    pub position_len: usize,
    pub rebalance_time: u64,
    pub max_bin_id: i32,
    pub active_id: i32,
    pub min_bin_id: i32,
    pub bin_step: u16,
    pub amount_x: u64,
    pub amount_y: u64,
    pub fee_x: u64,
    pub fee_y: u64,
    pub last_update_timestamp: u64,
}

impl PositionRaw {
    pub fn to_position_info(
        &self,
        token_x_decimals: u8,
        token_y_decimals: u8,
    ) -> Result<PositionInfo> {
        let bin_step = self.bin_step;
        let mut min_price = to_decimal(get_price_from_id(self.min_bin_id, bin_step)?)
            .ok_or(Error::msg("Math is overflow"))? as f64;
        let mut max_price = to_decimal(get_price_from_id(self.max_bin_id, bin_step)?)
            .ok_or(Error::msg("Math is overflow"))? as f64;

        let mut current_price = to_decimal(get_price_from_id(self.active_id, bin_step)?)
            .ok_or(Error::msg("Math is overflow"))? as f64;

        if token_x_decimals > token_y_decimals {
            let decimal_diff = token_x_decimals - token_y_decimals;
            min_price = min_price * 10f64.powf(decimal_diff as f64) / PRECISION as f64;
            max_price = max_price * 10f64.powf(decimal_diff as f64) / PRECISION as f64;
            current_price = current_price * 10f64.powf(decimal_diff as f64) / PRECISION as f64;
        } else {
            let decimal_diff = token_y_decimals - token_x_decimals;
            min_price = min_price / 10f64.powf(decimal_diff as f64) / PRECISION as f64;
            max_price = max_price / 10f64.powf(decimal_diff as f64) / PRECISION as f64;
            current_price = current_price * 10f64.powf(decimal_diff as f64) / PRECISION as f64;
        }

        let amount_x = self.amount_x as f64 / (10f64.powf(token_x_decimals as f64));
        let amount_y = self.amount_y as f64 / (10f64.powf(token_y_decimals as f64));
        let fee_x = self.fee_x as f64 / (10f64.powf(token_x_decimals as f64));
        let fee_y = self.fee_y as f64 / (10f64.powf(token_y_decimals as f64));

        return Ok(PositionInfo {
            position_len: self.position_len,
            rebalance_time: self.rebalance_time,
            max_price,
            current_price,
            min_price,
            amount_x,
            amount_y,
            fee_x,
            fee_y,
            last_update_timestamp: self.last_update_timestamp,
        });
    }
}

#[derive(Default, PartialEq, Debug, Clone, Serialize, Deserialize)]
pub struct PositionInfo {
    pub position_len: usize,
    pub rebalance_time: u64,
    pub max_price: f64,
    pub current_price: f64,
    pub min_price: f64,
    pub amount_x: f64,
    pub amount_y: f64,
    pub fee_x: f64,
    pub fee_y: f64,
    pub last_update_timestamp: u64,
}

impl SinglePosition {
    pub fn new(lb_pair: Pubkey) -> Self {
        SinglePosition {
            lb_pair,
            rebalance_time: 0,
            // token_x: Mint::default(),
            // token_y: Mint::default(),
            lb_pair_state: LbPair::default(),
            bin_arrays: HashMap::new(),
            positions: vec![],
            position_pks: vec![],
            min_bin_id: 0,
            max_bin_id: 0,
            last_update_timestamp: 0,
        }
    }
}

pub fn get_decimals(token_mint_pk: Pubkey, all_tokens: &HashMap<Pubkey, Mint>) -> u8 {
    let token = all_tokens.get(&token_mint_pk).unwrap();
    return token.decimals;
}
