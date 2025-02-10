use crate::*;

pub struct BinArrayManager<'a> {
    pub bin_arrays: &'a [BinArray],
}

impl<'a> BinArrayManager<'a> {
    pub fn get_bin(&self, bin_id: i32) -> Result<&Bin> {
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
            .checked_mul(MAX_BIN_PER_ARRAY as i32)
            .context("math is overflow")?;

        let upper_bin_id = upper_bin_array_idx
            .checked_mul(MAX_BIN_PER_ARRAY as i32)
            .context("math is overflow")?
            .checked_add(MAX_BIN_PER_ARRAY as i32)
            .context("math is overflow")?
            .checked_sub(1)
            .context("math is overflow")?;

        Ok((lower_bin_id, upper_bin_id))
    }

    /// Update reward + fee earning
    pub fn get_total_fee_pending(&self, position: &PositionV2) -> Result<(u64, u64)> {
        let (bin_arrays_lower_bin_id, bin_arrays_upper_bin_id) = self.get_lower_upper_bin_id()?;

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
                BinArrayManager::get_fee_pending_for_a_bin(position, bin_id, &bin)?;
            total_fee_x = fee_x_pending
                .checked_add(total_fee_x)
                .context("math is overflow")?;
            total_fee_y = fee_y_pending
                .checked_add(total_fee_y)
                .context("math is overflow")?;
        }

        Ok((total_fee_x, total_fee_y))
    }

    fn get_fee_pending_for_a_bin(
        position: &PositionV2,
        bin_id: i32,
        bin: &Bin,
    ) -> Result<(u64, u64)> {
        ensure!(
            bin_id >= position.lower_bin_id && bin_id <= position.upper_bin_id,
            "Bin is not within the position"
        );

        let idx = bin_id - position.lower_bin_id;

        let fee_infos = position.fee_infos[idx as usize];
        let liquidity_share_in_bin = position.liquidity_shares[idx as usize];

        let fee_x_per_token_stored = bin.fee_amount_x_per_token_stored;

        let liquidity_share_in_bin_downscaled = liquidity_share_in_bin
            .checked_shr(SCALE_OFFSET.into())
            .context("math is overflow")?;

        let new_fee_x: u64 = safe_mul_shr_cast(
            liquidity_share_in_bin_downscaled,
            fee_x_per_token_stored
                .checked_sub(fee_infos.fee_x_per_token_complete)
                .context("math is overflow")?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        let fee_x_pending = new_fee_x
            .checked_add(fee_infos.fee_x_pending)
            .context("math is overflow")?;

        let fee_y_per_token_stored = bin.fee_amount_y_per_token_stored;

        let new_fee_y: u64 = safe_mul_shr_cast(
            liquidity_share_in_bin_downscaled,
            fee_y_per_token_stored
                .checked_sub(fee_infos.fee_y_per_token_complete)
                .context("math is overflow")?,
            SCALE_OFFSET,
            Rounding::Down,
        )?;

        let fee_y_pending = new_fee_y
            .checked_add(fee_infos.fee_y_pending)
            .context("math is overflow")?;

        Ok((fee_x_pending, fee_y_pending))
    }
}
