use super::parameters::{StaticParameters, VariableParameters};
use anchor_lang::prelude::*;

#[zero_copy]
#[derive(InitSpace, Default, Debug)]
pub struct ProtocolFee {
    pub amount_x: u64,
    pub amount_y: u64,
}

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct LbPair {
    pub parameters: StaticParameters,
    pub v_parameters: VariableParameters,
    pub bump_seed: [u8; 1],
    /// Bin step signer seed
    pub bin_step_seed: [u8; 2],
    pub _padding0: u8,
    /// Active bin id
    pub active_id: i32,
    /// Bin step. Represent the price increment / decrement.
    pub bin_step: u16,
    pub _padding1: [u8; 6],
    /// Token X mint
    pub token_x_mint: Pubkey,
    /// Token Y mint
    pub token_y_mint: Pubkey,
    /// LB token X vault
    pub reserve_x: Pubkey,
    /// LB token Y vault
    pub reserve_y: Pubkey,
    /// Uncollected protocol fee
    pub protocol_fee: ProtocolFee,
    /// Protocol fee owner,
    pub fee_owner: Pubkey,
    /// Farming reward information
    pub reward_infos: [RewardInfo; 2],
    /// Oracle pubkey
    pub oracle: Pubkey,
    /// Packed initialized bin array state
    pub bin_array_bitmap: [u64; 16], // store default bin id from -512 to 511 (bin id from -35840 to 35840, price from 2.7e-16 to 3.6e15)
    /// Reserved space for future use
    pub _reserved: [u8; 192],
}

/// Stores the state relevant for tracking liquidity mining rewards
#[zero_copy]
#[derive(InitSpace, Default, Debug, PartialEq)]
pub struct RewardInfo {
    /// Reward token mint.
    pub mint: Pubkey,
    /// Reward vault token account.
    pub vault: Pubkey,
    /// Authority account that allows to fund rewards
    pub funder: Pubkey,
    /// Duration of the reward will last for
    pub reward_duration: u64, // 8
    /// Timestamp of when the reward end
    pub reward_duration_end: u64, // 8
    /// Reward rate distributed per seconds
    pub reward_rate: u128, // 8
    /// The last time reward states were updated
    pub last_update_time: u64, // 8
    /// padding, ignored field
    pub _padding: [u8; 8],
}
