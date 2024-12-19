use num_integer::Integer;

use crate::*;

pub trait BinArrayExtension {
    fn is_bin_id_within_range(&self, bin_id: i32) -> Result<bool>;
    fn get_bin_index_in_array(&self, bin_id: i32) -> Result<usize>;

    fn get_bin_array_lower_upper_bin_id(index: i32) -> Result<(i32, i32)>;
    fn bin_id_to_bin_array_index(bin_id: i32) -> Result<i32>;

    fn get_bin_mut<'a>(&'a mut self, bin_id: i32) -> Result<&'a mut Bin>;
}

impl BinArrayExtension for BinArray {
    fn get_bin_array_lower_upper_bin_id(index: i32) -> Result<(i32, i32)> {
        let lower_bin_id = index
            .checked_mul(MAX_BIN_PER_ARRAY as i32)
            .context("overflow")?;

        let upper_bin_id = lower_bin_id
            .checked_add(MAX_BIN_PER_ARRAY as i32)
            .context("overflow")?
            .checked_sub(1)
            .context("overflow")?;

        Ok((lower_bin_id, upper_bin_id))
    }

    fn is_bin_id_within_range(&self, bin_id: i32) -> Result<bool> {
        let (lower_bin_id, upper_bin_id) =
            BinArray::get_bin_array_lower_upper_bin_id(self.index as i32)?;

        Ok(bin_id >= lower_bin_id && bin_id <= upper_bin_id)
    }

    fn get_bin_mut<'a>(&'a mut self, bin_id: i32) -> Result<&'a mut Bin> {
        Ok(&mut self.bins[self.get_bin_index_in_array(bin_id)?])
    }

    fn get_bin_index_in_array(&self, bin_id: i32) -> Result<usize> {
        ensure!(self.is_bin_id_within_range(bin_id)?, "Bin id out of range");
        let (lower_bin_id, _) = BinArray::get_bin_array_lower_upper_bin_id(self.index as i32)?;
        let index = bin_id.checked_sub(lower_bin_id).context("overflow")?;
        Ok(index as usize)
    }

    fn bin_id_to_bin_array_index(bin_id: i32) -> Result<i32> {
        let (idx, rem) = bin_id.div_rem(&(MAX_BIN_PER_ARRAY as i32));

        if bin_id.is_negative() && rem != 0 {
            Ok(idx.checked_sub(1).context("overflow")?)
        } else {
            Ok(idx)
        }
    }
}
