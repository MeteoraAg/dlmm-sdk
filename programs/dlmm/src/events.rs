use anchor_lang::event;
use anchor_lang::prelude::*;

#[event]
pub struct CompositionFee {
    // Sender's public key
    pub from: Pubkey,
    // Bin id
    pub bin_id: i16,
    // Amount of fee in token X
    pub token_x_fee_amount: u64,
    // Amount of fee in token Y
    pub token_y_fee_amount: u64,
    // Amount of protocol fee in token X
    pub protocol_token_x_fee_amount: u64,
    // Amount of protocol fee in token Y
    pub protocol_token_y_fee_amount: u64,
}

#[event]
pub struct AddLiquidity {
    // Liquidity pool pair
    pub lb_pair: Pubkey,
    // Sender's public key
    pub from: Pubkey,
    // Address of the position
    pub position: Pubkey,
    // Amount of token X, and Y deposited
    pub amounts: [u64; 2],
    // Pair active bin during deposit
    pub active_bin_id: i32,
}

#[event]
pub struct RemoveLiquidity {
    // Liquidity pool pair
    pub lb_pair: Pubkey,
    // Sender's public key
    pub from: Pubkey,
    // Address of the position
    pub position: Pubkey,
    // Amount of token X, and Y withdrawn
    pub amounts: [u64; 2],
    // Pair active bin during withdrawal
    pub active_bin_id: i32,
}

#[event]
pub struct Swap {
    // Liquidity pool pair
    pub lb_pair: Pubkey,
    // Address initiated the swap
    pub from: Pubkey,
    // Initial active bin ID
    pub start_bin_id: i32,
    // Finalized active bin ID
    pub end_bin_id: i32,
    // In token amount
    pub amount_in: u64,
    // Out token amount
    pub amount_out: u64,
    // Direction of the swap
    pub swap_for_y: bool,
    // Include protocol fee
    pub fee: u64,
    // Part of fee
    pub protocol_fee: u64,
    // Fee bps
    pub fee_bps: u128,
    // Host fee
    pub host_fee: u64,
}

#[event]
pub struct ClaimReward {
    // Liquidity pool pair
    pub lb_pair: Pubkey,
    // Position address
    pub position: Pubkey,
    // Owner of the position
    pub owner: Pubkey,
    // Index of the farm reward the owner is claiming
    pub reward_index: u64,
    // Total amount of reward claimed
    pub total_reward: u64,
}

#[event]
pub struct PositionClose {
    // Address of the position
    pub position: Pubkey,
    // Owner of the position
    pub owner: Pubkey,
}

#[event]
pub struct ClaimFee {
    // Liquidity pool pair
    pub lb_pair: Pubkey,
    // Address of the position
    pub position: Pubkey,
    // Owner of the position
    pub owner: Pubkey,
    // Fee amount in token X
    pub fee_x: u64,
    // Fee amount in token Y
    pub fee_y: u64,
}

#[event]
pub struct PositionCreate {
    // Liquidity pool pair
    pub lb_pair: Pubkey,
    // Address of the position
    pub position: Pubkey,
    // Owner of the position
    pub owner: Pubkey,
}

#[event]
pub struct IncreaseObservation {
    // Oracle address
    pub oracle: Pubkey,
    // Oracle length
    pub new_observation_length: u64,
}
