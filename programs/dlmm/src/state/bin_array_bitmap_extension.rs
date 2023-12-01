use crate::constants::EXTENSION_BINARRAY_BITMAP_SIZE;
use anchor_lang::prelude::*;

#[account(zero_copy)]
#[derive(Debug, InitSpace)]
pub struct BinArrayBitmapExtension {
    pub lb_pair: Pubkey,
    /// Packed initialized bin array state for start_bin_index is positive
    pub positive_bin_array_bitmap: [[u64; 8]; EXTENSION_BINARRAY_BITMAP_SIZE],
    /// Packed initialized bin array state for start_bin_index is negative
    pub negative_bin_array_bitmap: [[u64; 8]; EXTENSION_BINARRAY_BITMAP_SIZE],
}
