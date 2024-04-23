use crate::{
    constants::{DEFAULT_BIN_PER_POSITION, NUM_REWARDS},
    math::safe_math::SafeMath,
};
use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct Position {
    /// The LB pair of this position
    pub lb_pair: Pubkey,
    /// Owner of the position. Client rely on this to to fetch their positions.
    pub owner: Pubkey,
    /// Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.
    pub liquidity_shares: [u64; DEFAULT_BIN_PER_POSITION],
    /// Farming reward information
    pub reward_infos: [UserRewardInfo; DEFAULT_BIN_PER_POSITION],
    /// Swap fee to claim information
    pub fee_infos: [FeeInfo; DEFAULT_BIN_PER_POSITION],
    /// Lower bin ID
    pub lower_bin_id: i32,
    /// Upper bin ID
    pub upper_bin_id: i32,
    /// Last updated timestamp
    pub last_updated_at: i64,
    /// Total claimed token fee X
    pub total_claimed_fee_x_amount: u64,
    /// Total claimed token fee Y
    pub total_claimed_fee_y_amount: u64,
    /// Total claimed rewards
    pub total_claimed_rewards: [u64; 2],
    /// Reserved space for future use
    pub _reserved: [u8; 160],
}

impl Position {
    // safe to use unwrap here
    pub fn width(&self) -> usize {
        self.upper_bin_id
            .safe_add(1)
            .unwrap()
            .safe_sub(self.lower_bin_id)
            .unwrap() as usize
    }
}

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct PositionV2 {
    /// The LB pair of this position
    pub lb_pair: Pubkey,
    /// Owner of the position. Client rely on this to to fetch their positions.
    pub owner: Pubkey,
    /// Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.
    pub liquidity_shares: [u128; DEFAULT_BIN_PER_POSITION],
    /// Farming reward information
    pub reward_infos: [UserRewardInfo; DEFAULT_BIN_PER_POSITION],
    /// Swap fee to claim information
    pub fee_infos: [FeeInfo; DEFAULT_BIN_PER_POSITION],
    /// Lower bin ID
    pub lower_bin_id: i32,
    /// Upper bin ID
    pub upper_bin_id: i32,
    /// Last updated timestamp
    pub last_updated_at: i64,
    /// Total claimed token fee X
    pub total_claimed_fee_x_amount: u64,
    /// Total claimed token fee Y
    pub total_claimed_fee_y_amount: u64,
    /// Total claimed rewards
    pub total_claimed_rewards: [u64; 2],
    /// Operator of position
    pub operator: Pubkey,
    /// Slot which the locked liquidity can be withdraw
    pub lock_release_slot: u64,
    /// Is the position subjected to liquidity locking for the launch pool.
    pub subjected_to_bootstrap_liquidity_locking: u8,
    /// Address is able to claim fee in this position, only valid for bootstrap_liquidity_position
    pub fee_owner: Pubkey,
    /// Reserved space for future use
    pub _reserved: [u8; 87],
}

const_assert_eq!(std::mem::size_of::<PositionV2>(), 8112);

impl Default for PositionV2 {
    fn default() -> Self {
        Self {
            lb_pair: Pubkey::default(),
            owner: Pubkey::default(),
            lower_bin_id: 0,
            upper_bin_id: 0,
            last_updated_at: 0,
            liquidity_shares: [0u128; DEFAULT_BIN_PER_POSITION],
            reward_infos: [UserRewardInfo::default(); DEFAULT_BIN_PER_POSITION],
            fee_infos: [FeeInfo::default(); DEFAULT_BIN_PER_POSITION],
            total_claimed_fee_x_amount: 0,
            total_claimed_fee_y_amount: 0,
            total_claimed_rewards: [0u64; 2],
            operator: Pubkey::default(),
            subjected_to_bootstrap_liquidity_locking: 0,
            lock_release_slot: 0,
            fee_owner: Pubkey::default(),
            _reserved: [0u8; 87],
        }
    }
}
impl PositionV2 {
    // safe to use unwrap here
    pub fn width(&self) -> usize {
        self.upper_bin_id
            .safe_add(1)
            .unwrap()
            .safe_sub(self.lower_bin_id)
            .unwrap() as usize
    }
}

const_assert_eq!(std::mem::size_of::<PositionV2>(), 8112);

#[zero_copy]
#[derive(Default, Debug, AnchorDeserialize, AnchorSerialize, InitSpace, PartialEq)]
pub struct FeeInfo {
    pub fee_x_per_token_complete: u128,
    pub fee_y_per_token_complete: u128,
    pub fee_x_pending: u64,
    pub fee_y_pending: u64,
}

#[zero_copy]
#[derive(Default, Debug, AnchorDeserialize, AnchorSerialize, InitSpace, PartialEq)]
pub struct UserRewardInfo {
    pub reward_per_token_completes: [u128; NUM_REWARDS],
    pub reward_pendings: [u64; NUM_REWARDS],
}
