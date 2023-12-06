use anchor_lang::prelude::Result;
use dlmm_program_interface::{
    constants::{BIN_ARRAY_BITMAP_SIZE, EXTENSION_BINARRAY_BITMAP_SIZE},
    errors::LBError,
};
use ruint::aliases::U512;

pub fn next_bin_array_index_with_liquidity(
    negative_bin_array_bitmap: &[[u64; 8]],
    positive_bin_array_bitmap: &[[u64; 8]],
    swap_for_y: bool,
    start_index: i32,
) -> Result<(i32, bool)> {
    let (min_bitmap_id, max_bit_map_id) = bitmap_range();
    if start_index > 0 {
        if swap_for_y {
            match iter_bitmap(
                start_index,
                BIN_ARRAY_BITMAP_SIZE,
                negative_bin_array_bitmap,
                positive_bin_array_bitmap,
            )? {
                Some(value) => return Ok((value, true)),
                None => return Ok((BIN_ARRAY_BITMAP_SIZE - 1, false)),
            }
        } else {
            match iter_bitmap(
                start_index,
                max_bit_map_id,
                negative_bin_array_bitmap,
                positive_bin_array_bitmap,
            )? {
                Some(value) => return Ok((value, true)),
                None => return Err(LBError::CannotFindNonZeroLiquidityBinArrayId.into()),
            }
        }
    } else {
        if swap_for_y {
            match iter_bitmap(
                start_index,
                min_bitmap_id,
                negative_bin_array_bitmap,
                positive_bin_array_bitmap,
            )? {
                Some(value) => return Ok((value, true)),
                None => return Err(LBError::CannotFindNonZeroLiquidityBinArrayId.into()),
            }
        } else {
            match iter_bitmap(
                start_index,
                -BIN_ARRAY_BITMAP_SIZE - 1,
                negative_bin_array_bitmap,
                positive_bin_array_bitmap,
            )? {
                Some(value) => return Ok((value, true)),
                None => return Ok((-BIN_ARRAY_BITMAP_SIZE, false)),
            }
        }
    }
}

fn get_bitmap_offset(bin_array_index: i32) -> Result<usize> {
    let offset = if bin_array_index > 0 {
        bin_array_index / BIN_ARRAY_BITMAP_SIZE - 1
    } else {
        -(bin_array_index + 1) / BIN_ARRAY_BITMAP_SIZE - 1
    };
    Ok(offset as usize)
}

fn bin_array_offset_in_bitmap(bin_array_index: i32) -> Result<usize> {
    if bin_array_index > 0 {
        Ok((bin_array_index % BIN_ARRAY_BITMAP_SIZE) as usize)
    } else {
        Ok(((-(bin_array_index + 1)) % BIN_ARRAY_BITMAP_SIZE) as usize)
    }
}

pub fn bitmap_range() -> (i32, i32) {
    return (
        -BIN_ARRAY_BITMAP_SIZE * (EXTENSION_BINARRAY_BITMAP_SIZE as i32 + 1),
        BIN_ARRAY_BITMAP_SIZE * (EXTENSION_BINARRAY_BITMAP_SIZE as i32 + 1) - 1,
    );
}

fn to_bin_array_index(offset: usize, bin_array_offset: usize, is_positive: bool) -> Result<i32> {
    let offset = offset as i32;
    let bin_array_offset = bin_array_offset as i32;
    if is_positive {
        Ok((offset + 1) * BIN_ARRAY_BITMAP_SIZE + bin_array_offset)
    } else {
        Ok(-((offset + 1) * BIN_ARRAY_BITMAP_SIZE + bin_array_offset) - 1)
    }
}

fn iter_bitmap(
    start_index: i32,
    end_index: i32,
    negative_bin_array_bitmap: &[[u64; 8]],
    positive_bin_array_bitmap: &[[u64; 8]],
) -> Result<Option<i32>> {
    let offset: usize = get_bitmap_offset(start_index)?;
    let bin_array_offset = bin_array_offset_in_bitmap(start_index)?;
    if start_index < 0 {
        if start_index <= end_index {
            for i in (0..=offset).rev() {
                let mut bin_array_bitmap = U512::from_limbs_slice(&negative_bin_array_bitmap[i]);

                if i == offset {
                    bin_array_bitmap =
                        bin_array_bitmap << BIN_ARRAY_BITMAP_SIZE as usize - bin_array_offset - 1;
                    if bin_array_bitmap.eq(&U512::ZERO) {
                        continue;
                    }

                    let bin_array_offset_in_bitmap =
                        bin_array_offset - bin_array_bitmap.leading_zeros();

                    return Ok(Some(to_bin_array_index(
                        i,
                        bin_array_offset_in_bitmap,
                        false,
                    )?));
                }
                if bin_array_bitmap.eq(&U512::ZERO) {
                    continue;
                }
                let bin_array_offset_in_bitmap =
                    BIN_ARRAY_BITMAP_SIZE as usize - bin_array_bitmap.leading_zeros() - 1;

                return Ok(Some(to_bin_array_index(
                    i,
                    bin_array_offset_in_bitmap,
                    false,
                )?));
            }
        } else {
            for i in offset..EXTENSION_BINARRAY_BITMAP_SIZE {
                let mut bin_array_bitmap = U512::from_limbs_slice(&negative_bin_array_bitmap[i]);
                if i == offset {
                    bin_array_bitmap = bin_array_bitmap >> bin_array_offset;
                    if bin_array_bitmap.eq(&U512::ZERO) {
                        continue;
                    }

                    let bin_array_offset_in_bitmap =
                        bin_array_offset + bin_array_bitmap.trailing_zeros();

                    return Ok(Some(to_bin_array_index(
                        i,
                        bin_array_offset_in_bitmap,
                        false,
                    )?));
                }

                if bin_array_bitmap.eq(&U512::ZERO) {
                    continue;
                }
                let bin_array_offset_in_bitmap = bin_array_bitmap.trailing_zeros();

                return Ok(Some(to_bin_array_index(
                    i,
                    bin_array_offset_in_bitmap,
                    false,
                )?));
            }
        }
    } else {
        if start_index <= end_index {
            for i in offset..EXTENSION_BINARRAY_BITMAP_SIZE {
                let mut bin_array_bitmap = U512::from_limbs_slice(&positive_bin_array_bitmap[i]);
                if i == offset {
                    bin_array_bitmap = bin_array_bitmap >> bin_array_offset;
                    if bin_array_bitmap.eq(&U512::ZERO) {
                        continue;
                    }

                    let bin_array_offset_in_bitmap =
                        bin_array_offset + bin_array_bitmap.trailing_zeros();
                    return Ok(Some(to_bin_array_index(
                        i,
                        bin_array_offset_in_bitmap,
                        true,
                    )?));
                }

                if bin_array_bitmap.eq(&U512::ZERO) {
                    continue;
                }

                let bin_array_offset_in_bitmap = bin_array_bitmap.trailing_zeros();

                return Ok(Some(to_bin_array_index(
                    i,
                    bin_array_offset_in_bitmap,
                    true,
                )?));
            }
        } else {
            for i in (0..=offset).rev() {
                let mut bin_array_bitmap = U512::from_limbs_slice(&positive_bin_array_bitmap[i]);

                if i == offset {
                    bin_array_bitmap =
                        bin_array_bitmap << BIN_ARRAY_BITMAP_SIZE as usize - bin_array_offset - 1;

                    if bin_array_bitmap.eq(&U512::ZERO) {
                        continue;
                    }
                    let bin_array_offset_in_bitmap =
                        bin_array_offset - bin_array_bitmap.leading_zeros();
                    return Ok(Some(to_bin_array_index(
                        i,
                        bin_array_offset_in_bitmap,
                        true,
                    )?));
                }

                if bin_array_bitmap.eq(&U512::ZERO) {
                    continue;
                }
                let bin_array_offset_in_bitmap =
                    BIN_ARRAY_BITMAP_SIZE as usize - bin_array_bitmap.leading_zeros() - 1;

                return Ok(Some(to_bin_array_index(
                    i,
                    bin_array_offset_in_bitmap,
                    true,
                )?));
            }
        }
    }
    Ok(None)
}
