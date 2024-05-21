use crate::math::get_id_from_price;
use crate::math::price_per_token_to_per_lamport;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_spl::token_interface::Mint;
use anyhow::*;
use lb_clmm::constants::{MAX_BIN_PER_ARRAY, MAX_BIN_PER_POSITION};
use lb_clmm::math::safe_math::SafeMath;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::math::u64x64_math::SCALE_OFFSET;
use lb_clmm::math::utils_math::safe_mul_shr_cast;
use lb_clmm::state::bin::Bin;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda::*;
use std::ops::Deref;
use std::result::Result::Ok;
#[derive(Debug)]
pub struct CheckMyBalanceParameters {
    pub lb_pair: Pubkey,
    pub base_position_key: Pubkey,
    pub min_price: f64,
    pub max_price: f64,
}

pub async fn check_my_balance<C: Deref<Target = impl Signer> + Clone>(
    params: CheckMyBalanceParameters,
    program: &Program<C>,
) -> Result<()> {
    let CheckMyBalanceParameters {
        lb_pair,
        base_position_key,
        min_price,
        max_price,
    } = params;
    let lb_pair_state = program.account::<LbPair>(lb_pair).await?;

    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint).await?;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    println!("active bin {}", lb_pair_state.active_id);

    let bin_step = lb_pair_state.bin_step;
    let min_price_per_lamport = price_per_token_to_per_lamport(
        min_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;
    let min_active_id = get_id_from_price(bin_step, &min_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let max_price_per_lamport = price_per_token_to_per_lamport(
        max_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;
    let max_active_id = get_id_from_price(bin_step, &max_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let width = MAX_BIN_PER_POSITION as i32;
    let mut total_amount_x = 0u64;
    let mut total_amount_y = 0u64;
    let mut total_fee_x_pending = 0u64;
    let mut total_fee_y_pending = 0u64;

    for i in min_active_id..max_active_id {
        let (position, _bump) = derive_position_pda(lb_pair, base_position_key, i, width);
        match program.account::<PositionV2>(position).await {
            Ok(position_state) => {
                let lower_bin_array_idx =
                    BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
                let upper_bin_array_idx =
                    lower_bin_array_idx.checked_add(1).context("MathOverflow")?;

                let mut bin_arrays = vec![];
                for i in lower_bin_array_idx..=upper_bin_array_idx {
                    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, i.into());

                    match program.account::<BinArray>(bin_array).await {
                        Ok(bin_array_state) => bin_arrays.push(bin_array_state),
                        Err(_err) => {}
                    }
                }
                let bin_array_manager = BinArrayManager {
                    bin_arrays: &bin_arrays,
                };
                for (i, &share) in position_state.liquidity_shares.iter().enumerate() {
                    if share == 0 {
                        continue;
                    }
                    let bin_id = position_state.from_idx_to_bin_id(i)?;
                    let bin = bin_array_manager.get_bin(bin_id)?;
                    let (amount_x, amount_y) = bin.calculate_out_amount(share)?;
                    total_amount_x = total_amount_x.safe_add(amount_x).unwrap();
                    total_amount_y = total_amount_y.safe_add(amount_y).unwrap();
                }

                let (fee_x_pending, fee_y_pending) =
                    bin_array_manager.get_total_fee_pending(&position_state)?;
                total_fee_x_pending = total_fee_x_pending.checked_add(fee_x_pending).unwrap();
                total_fee_y_pending = total_fee_y_pending.checked_add(fee_y_pending).unwrap();
            }
            Err(_err) => continue, // TODO handle rpc call here
        }
    }
    let total_amount_x =
        total_amount_x as f64 / (10u64.pow(token_mint_base.decimals as u32) as f64);
    let total_amount_y =
        total_amount_y as f64 / (10u64.pow(token_mint_quote.decimals as u32) as f64);

    let total_fee_x_pending =
        total_fee_x_pending as f64 / (10u64.pow(token_mint_base.decimals as u32) as f64);
    let total_fee_y_pending =
        total_fee_y_pending as f64 / (10u64.pow(token_mint_quote.decimals as u32) as f64);

    println!(
        "amount_x {total_amount_x} amount_y {total_amount_y} fee_x_pending {total_fee_x_pending} fee_y_pending {total_fee_y_pending}"
    );
    Ok(())
}

pub struct BinArrayManager<'a> {
    bin_arrays: &'a Vec<BinArray>,
}
impl<'a> BinArrayManager<'a> {
    pub fn get_bin(&self, bin_id: i32) -> anyhow::Result<&Bin> {
        let bin_array_idx = BinArray::bin_id_to_bin_array_index(bin_id)?;
        match self
            .bin_arrays
            .iter()
            .find(|ba| ba.index == bin_array_idx as i64)
        {
            Some(bin_array) => Ok(bin_array.get_bin(bin_id)?),
            None => Err(anyhow::Error::msg("Cannot get bin")),
        }
    }

    pub fn get_lower_upper_bin_id(&self) -> Result<(i32, i32)> {
        let lower_bin_array_idx = self.bin_arrays[0].index as i32;
        let upper_bin_array_idx = self.bin_arrays[self.bin_arrays.len() - 1].index as i32;

        let lower_bin_id = lower_bin_array_idx
            .safe_mul(MAX_BIN_PER_ARRAY as i32)
            .map_err(|_| anyhow::Error::msg("math is overflow"))?;
        let upper_bin_id = upper_bin_array_idx
            .safe_mul(MAX_BIN_PER_ARRAY as i32)
            .map_err(|_| anyhow::Error::msg("math is overflow"))?
            .safe_add(MAX_BIN_PER_ARRAY as i32)
            .map_err(|_| anyhow::Error::msg("math is overflow"))?
            .safe_sub(1)
            .map_err(|_| anyhow::Error::msg("math is overflow"))?;

        Ok((lower_bin_id, upper_bin_id))
    }

    /// Update reward + fee earning
    pub fn get_total_fee_pending(&self, position: &PositionV2) -> Result<(u64, u64)> {
        let (bin_arrays_lower_bin_id, bin_arrays_upper_bin_id) = self.get_lower_upper_bin_id()?;

        // Make sure that the bin arrays cover all the bins of the position.
        // TODO: Should we? Maybe we shall update only the bins the user are interacting with, and allow chunk for claim reward.
        if position.lower_bin_id < bin_arrays_lower_bin_id
            && position.upper_bin_id > bin_arrays_upper_bin_id
        {
            return Err(anyhow::Error::msg("Bin array is not correct"));
        }

        let mut total_fee_x = 0u64;
        let mut total_fee_y = 0u64;
        for bin_id in position.lower_bin_id..=position.upper_bin_id {
            let bin = self.get_bin(bin_id)?;
            let (fee_x_pending, fee_y_pending) =
                BinArrayManager::get_fee_pending_for_a_bin(position, bin_id, bin)?;
            total_fee_x = fee_x_pending
                .safe_add(total_fee_x)
                .map_err(|_| anyhow::Error::msg("math is overflow"))?;
            total_fee_y = fee_y_pending
                .safe_add(total_fee_y)
                .map_err(|_| anyhow::Error::msg("math is overflow"))?;
        }

        Ok((total_fee_x, total_fee_y))
    }

    fn get_fee_pending_for_a_bin(
        position: &PositionV2,
        bin_id: i32,
        bin: &Bin,
    ) -> Result<(u64, u64)> {
        let idx = position.get_idx(bin_id)?;

        let fee_infos = &position.fee_infos[idx];

        let fee_x_per_token_stored = bin.fee_amount_x_per_token_stored;

        let new_fee_x: u64 = safe_mul_shr_cast(
            position.liquidity_shares[idx],
            fee_x_per_token_stored
                .safe_sub(fee_infos.fee_x_per_token_complete)
                .map_err(|_| anyhow::Error::msg("math is overflow"))?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        let fee_x_pending = new_fee_x
            .safe_add(fee_infos.fee_x_pending)
            .map_err(|_| anyhow::Error::msg("math is overflow"))?;

        let fee_y_per_token_stored = bin.fee_amount_y_per_token_stored;
        let new_fee_y: u64 = safe_mul_shr_cast(
            position.liquidity_shares[idx],
            fee_y_per_token_stored
                .safe_sub(fee_infos.fee_y_per_token_complete)
                .map_err(|_| anyhow::Error::msg("math is overflow"))?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        let fee_y_pending = new_fee_y
            .safe_add(fee_infos.fee_y_pending)
            .map_err(|_| anyhow::Error::msg("math is overflow"))?;

        Ok((fee_x_pending, fee_y_pending))
    }
}
