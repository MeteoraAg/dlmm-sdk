use crate::bitmap::{bitmap_extension, bitmap_internal};
use anchor_lang::prelude::*;
use dlmm_program_interface::{
    errors::LBError,
    state::{bin::bin_id_to_bin_array_index, bin_array_bitmap_extension::BinArrayBitmapExtension},
};

fn is_overflow_default_bin_array_bitmap(bin_array_index: i32) -> bool {
    let (min_bitmap_id, max_bitmap_id) = bitmap_internal::bitmap_range();
    bin_array_index > max_bitmap_id || bin_array_index < min_bitmap_id
}

pub fn find_next_bin_array_index_with_liquidity(
    active_bin_id: i32,
    swap_for_y: bool,
    internal_bitmap: &[u64; 16],
    extension_bitmap: Option<&BinArrayBitmapExtension>,
) -> Result<Option<i32>> {
    let mut start_bin_array_index = bin_id_to_bin_array_index(active_bin_id);

    loop {
        if is_overflow_default_bin_array_bitmap(start_bin_array_index) {
            // Search extension
            if extension_bitmap.is_none() {
                return Ok(None);
            }
            if let Some(extension_bitmap) = extension_bitmap {
                match bitmap_extension::next_bin_array_index_with_liquidity(
                    &extension_bitmap.negative_bin_array_bitmap,
                    &extension_bitmap.positive_bin_array_bitmap,
                    swap_for_y,
                    start_bin_array_index,
                ) {
                    Ok((bin_array_index, found)) => {
                        if found {
                            return Ok(Some(bin_array_index));
                        }
                        // Switch to internal
                        start_bin_array_index = bin_array_index;
                    }
                    Err(err) => {
                        if err.eq(&Error::from(LBError::CannotFindNonZeroLiquidityBinArrayId)) {
                            return Ok(None);
                        } else {
                            return Err(err);
                        }
                    }
                }
            }
        } else {
            // Search internal bitmap
            let (bin_array_index, found) = bitmap_internal::next_bin_array_index_with_liquidity(
                internal_bitmap,
                swap_for_y,
                start_bin_array_index,
            )?;
            if found {
                return Ok(Some(bin_array_index));
            }
            // Switch to extension
            start_bin_array_index = bin_array_index;
        }
    }
}
