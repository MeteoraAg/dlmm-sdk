use crate::constants::{MAX_BIN_PER_ARRAY, NUM_REWARDS};
use anchor_lang::prelude::*;

#[zero_copy]
#[derive(Default, Debug, InitSpace)]
pub struct Bin {
    /// Amount of token X in the bin. This already excluded protocol fees.
    pub amount_x: u64,
    /// Amount of token Y in the bin. This already excluded protocol fees.
    pub amount_y: u64,
    /// Bin price
    pub price: u128,
    /// Liquidities of the bin. This is the same as LP mint supply.
    pub liquidity_supply: u64,
    /// padding, ignored field
    pub _padding: [u8; 8],
    /// reward_a_per_token_stored
    pub reward_per_token_stored: [u128; NUM_REWARDS],
    /// Swap fee amount of token X per liquidity deposited.
    pub fee_amount_x_per_token_stored: u128,
    /// Swap fee amount of token Y per liquidity deposited.
    pub fee_amount_y_per_token_stored: u128,
    /// Total token X swap into the bin. Only used for tracking purpose.
    pub amount_x_in: u128,
    /// Total token Y swap into he bin. Only used for tracking purpose.
    pub amount_y_in: u128,
}

#[account(zero_copy)]
#[derive(Debug, InitSpace)]
/// An account to contain a range of bin. For example: Bin 100 <-> 200.
/// For example:
/// BinArray index: 0 contains bin 0 <-> 599
/// index: 2 contains bin 600 <-> 1199, ...
pub struct BinArray {
    pub index: i64,
    pub _padding: [u8; 8],
    pub lb_pair: Pubkey,
    pub bins: [Bin; MAX_BIN_PER_ARRAY],
}

/// Get bin array index from bin id
pub fn bin_id_to_bin_array_index(bin_id: i32) -> i32 {
    let idx = bin_id / MAX_BIN_PER_ARRAY as i32;
    let rem = bin_id % MAX_BIN_PER_ARRAY as i32;

    if bin_id.is_negative() && rem != 0 {
        idx - 1
    } else {
        idx
    }
}

/// Get lower and upper bin id of the given bin array index
pub fn get_bin_array_lower_upper_bin_id(index: i32) -> (i32, i32) {
    let lower_bin_id = index * MAX_BIN_PER_ARRAY as i32;
    let upper_bin_id = lower_bin_id + MAX_BIN_PER_ARRAY as i32 - 1;

    (lower_bin_id, upper_bin_id)
}
