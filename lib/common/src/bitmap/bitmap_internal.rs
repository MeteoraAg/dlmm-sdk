use std::ops::{Shl, Shr};

use anchor_lang::prelude::*;
use dlmm_program_interface::constants::BIN_ARRAY_BITMAP_SIZE;
use ruint::aliases::U1024;

pub fn bitmap_range() -> (i32, i32) {
    (-BIN_ARRAY_BITMAP_SIZE, BIN_ARRAY_BITMAP_SIZE - 1)
}

fn get_bin_array_offset(bin_array_index: i32) -> usize {
    (bin_array_index + BIN_ARRAY_BITMAP_SIZE) as usize
}

pub fn next_bin_array_index_with_liquidity(
    internal_bitmap: &[u64; 16],
    swap_for_y: bool,
    start_index: i32,
) -> Result<(i32, bool)> {
    let bin_array_bitmap = U1024::from_limbs_slice(internal_bitmap);
    let array_offset: usize = get_bin_array_offset(start_index);
    let (min_bitmap_id, max_bitmap_id) = bitmap_range();
    if swap_for_y {
        let bitmap_range = (max_bitmap_id - min_bitmap_id) as usize;
        let offset_bit_map = bin_array_bitmap.shl(bitmap_range - array_offset);

        if offset_bit_map.eq(&U1024::ZERO) {
            return Ok((min_bitmap_id - 1, false));
        } else {
            let next_bit = offset_bit_map.leading_zeros();
            return Ok((start_index - next_bit as i32, true));
        }
    } else {
        let offset_bit_map = bin_array_bitmap.shr(array_offset);
        if offset_bit_map.eq(&U1024::ZERO) {
            return Ok((max_bitmap_id + 1, false));
        } else {
            let next_bit = offset_bit_map.trailing_zeros();
            return Ok((start_index + next_bit as i32, true));
        };
    }
}
