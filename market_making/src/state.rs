use crate::*;
use anchor_spl::token_interface::Mint;
use bin_array_manager::BinArrayManager;
use rust_decimal::{prelude::FromPrimitive, prelude::ToPrimitive, Decimal, MathematicalOps};
use std::collections::HashMap;
pub type MintWithProgramId = (Mint, Pubkey);

pub struct AllPosition {
    pub all_positions: HashMap<Pubkey, SinglePosition>, // hashmap of pool pubkey and a position
    pub tokens: HashMap<Pubkey, MintWithProgramId>,     // cached token info
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
    pub lb_pair_state: Option<LbPair>,
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
        let lb_pair_state = self.lb_pair_state.context("Missing lb pair state")?;
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
            let bin_array_keys = position.get_bin_array_keys_coverage()?;
            let mut bin_arrays = vec![];

            for key in bin_array_keys {
                let bin_array_state = self
                    .bin_arrays
                    .get(&key)
                    .ok_or(Error::msg("Cannot get binarray"))?;
                bin_arrays.push(*bin_array_state);
            }

            let bin_array_manager = BinArrayManager {
                bin_arrays: &bin_arrays,
            };

            for (i, liquidity_share) in position.liquidity_shares.iter().enumerate() {
                let bin_id = position
                    .lower_bin_id
                    .checked_add(i as i32)
                    .context("math is overflow")?;

                let bin = bin_array_manager.get_bin(bin_id)?;
                let (bin_amount_x, bin_amount_y) = bin.calculate_out_amount(*liquidity_share)?;

                amount_x = amount_x
                    .checked_add(bin_amount_x)
                    .context("math is overflow")?;

                amount_y = amount_y
                    .checked_add(bin_amount_y)
                    .context("math is overflow")?;
            }

            let (fee_x_pending, fee_y_pending) =
                bin_array_manager.get_total_fee_pending(position)?;

            fee_x = fee_x
                .checked_add(fee_x_pending)
                .context("math is overflow")?;
            fee_y = fee_y
                .checked_add(fee_y_pending)
                .context("math is overflow")?;
        }

        let lb_pair_state = self.lb_pair_state.context("Missing lb pair state")?;

        Ok(PositionRaw {
            position_len: self.positions.len(),
            bin_step: lb_pair_state.bin_step,
            rebalance_time: self.rebalance_time,
            min_bin_id: self.min_bin_id,
            active_id: lb_pair_state.active_id,
            max_bin_id: self.max_bin_id,
            amount_x,
            amount_y,
            fee_x,
            fee_y,
            last_update_timestamp: self.last_update_timestamp,
        })
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

        let ui_price_adjustment_factor =
            Decimal::TEN.powi(token_x_decimals as i64 - token_y_decimals as i64);

        let token_x_ui_adjustment_factor = 10f64.powi(token_x_decimals.into());
        let token_y_ui_adjustment_factor = 10f64.powi(token_y_decimals.into());

        let min_price_fp = get_price_from_id(self.min_bin_id, bin_step)?;
        let min_price =
            Decimal::from_u128(min_price_fp).context("Math is overflow")? / Decimal::from(ONE);
        let adjusted_min_price = min_price
            .checked_mul(ui_price_adjustment_factor.into())
            .context("Math is overflow")?
            .to_f64()
            .context("Math is overflow")?;

        let max_price_fp = get_price_from_id(self.max_bin_id, bin_step)?;
        let max_price =
            Decimal::from_u128(max_price_fp).context("Math is overflow")? / Decimal::from(ONE);
        let adjusted_max_price = max_price
            .checked_mul(ui_price_adjustment_factor.into())
            .context("Math is overflow")?
            .to_f64()
            .context("Math is overflow")?;

        let current_price_fp = get_price_from_id(self.active_id, bin_step)?;
        let current_price =
            Decimal::from_u128(current_price_fp).context("Math is overflow")? / Decimal::from(ONE);
        let adjusted_current_price = current_price
            .checked_mul(ui_price_adjustment_factor.into())
            .context("Math is overflow")?
            .to_f64()
            .context("Math is overflow")?;

        let amount_x = self.amount_x as f64 / token_x_ui_adjustment_factor;
        let amount_y = self.amount_y as f64 / token_y_ui_adjustment_factor;

        let fee_x = self.fee_x as f64 / token_x_ui_adjustment_factor;
        let fee_y = self.fee_y as f64 / token_y_ui_adjustment_factor;

        return Ok(PositionInfo {
            position_len: self.position_len,
            rebalance_time: self.rebalance_time,
            max_price: adjusted_max_price,
            current_price: adjusted_current_price,
            min_price: adjusted_min_price,
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
            lb_pair_state: None,
            bin_arrays: HashMap::new(),
            positions: vec![],
            position_pks: vec![],
            min_bin_id: 0,
            max_bin_id: 0,
            last_update_timestamp: 0,
        }
    }
}

pub fn get_decimals(token_mint_pk: Pubkey, all_tokens: &HashMap<Pubkey, MintWithProgramId>) -> u8 {
    let token = all_tokens.get(&token_mint_pk).unwrap();
    return token.0.decimals;
}
