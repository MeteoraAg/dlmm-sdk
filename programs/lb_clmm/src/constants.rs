use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

// TODO: Macro to compute the constants which changes based on the bit system used ?
// Smallest step between bin is 0.01%, 1 bps
#[constant]
pub const BASIS_POINT_MAX: i32 = 10000;

/// Maximum number of bin a bin array able to contains.
#[constant]
pub const MAX_BIN_PER_ARRAY: usize = 70;

/// Maximum number of bin per position contains.
#[constant]
pub const MAX_BIN_PER_POSITION: usize = 70;

/// Minimum bin ID supported. Computed based on 1 bps.
#[constant]
pub const MIN_BIN_ID: i32 = -443636;

/// Maximum bin ID supported. Computed based on 1 bps.
#[constant]
pub const MAX_BIN_ID: i32 = 443636;

/// Maximum fee rate. 10%
#[constant]
pub const MAX_FEE_RATE: u64 = 100_000_000;

#[constant]
pub const FEE_PRECISION: u64 = 1_000_000_000;

/// Maximum protocol share of the fee. 25%
#[constant]
pub const MAX_PROTOCOL_SHARE: u16 = 2_500;

/// Host fee. 20%
#[constant]
pub const HOST_FEE_BPS: u16 = 2_000;

pub const U24_MAX: u32 = 0xffffff;

// Number of rewards supported by pool
#[constant]
pub const NUM_REWARDS: usize = 2;

// Minimum reward duration
#[constant]
pub const MIN_REWARD_DURATION: u64 = 1;

#[constant]
pub const MAX_REWARD_DURATION: u64 = 31536000; // 1 year = 365 * 24 * 3600

pub const DEFAULT_OBSERVATION_LENGTH: u64 = 100;
pub const SAMPLE_LIFETIME: u64 = 120; // 2
#[constant]
pub const EXTENSION_BINARRAY_BITMAP_SIZE: usize = 12;

#[constant]
pub const BIN_ARRAY_BITMAP_SIZE: i32 = 512;

pub const MAX_BASE_FACTOR_STEP: u16 = 100; // 100 bps, 1%

pub const MAX_FEE_UPDATE_WINDOW: i64 = 0;

#[constant]
pub const MAX_REWARD_BIN_SPLIT: usize = 15;

#[cfg(feature = "localnet")]
pub const SLOT_BUFFER: u64 = 5;

// 1 slot ~400ms
#[cfg(not(feature = "localnet"))]
pub const SLOT_BUFFER: u64 = 9000;

#[cfg(feature = "localnet")]
pub const TIME_BUFFER: u64 = 5;

#[cfg(not(feature = "localnet"))]
pub const TIME_BUFFER: u64 = 3600;

#[cfg(not(feature = "localnet"))]
pub const MAX_ACTIVATION_SLOT_DURATION: u64 = SLOT_BUFFER * 24 * 31; // 31 days

#[cfg(feature = "localnet")]
pub const MAX_ACTIVATION_SLOT_DURATION: u64 = SLOT_BUFFER * 24; // 1 days

#[cfg(not(feature = "localnet"))]
pub const MAX_ACTIVATION_TIME_DURATION: u64 = TIME_BUFFER * 24 * 31; // 31 days

#[cfg(feature = "localnet")]
pub const MAX_ACTIVATION_TIME_DURATION: u64 = TIME_BUFFER * 24; // 1 days

#[cfg(not(feature = "localnet"))]
pub const FIVE_MINUTES_SLOT_BUFFER: u64 = SLOT_BUFFER / 12; // 5 minutes

#[cfg(feature = "localnet")]
pub const FIVE_MINUTES_SLOT_BUFFER: u64 = 5;

#[cfg(not(feature = "localnet"))]
pub const FIVE_MINUTES_TIME_BUFFER: u64 = TIME_BUFFER / 12; // 5 minutes

#[cfg(feature = "localnet")]
pub const FIVE_MINUTES_TIME_BUFFER: u64 = 5;

// ILM token launch protocol fee
pub const ILM_PROTOCOL_SHARE: u16 = 2000; // 20%

/// Maximum bin step
#[constant]
pub const MAX_BIN_STEP: u16 = 400;

/// Maximum base fee, base_fee / 10^9 = fee_in_percentage
#[constant]
pub const MAX_BASE_FEE: u128 = 100_000_000; // 10% (10^9 * 10 / 100)

/// Minimum base fee
#[constant]
pub const MIN_BASE_FEE: u128 = 100_000; // 0.01% (10^9 * 0.01 / 100)

// Supported quote mints
const SOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
const USDC: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const QUOTE_MINTS: [Pubkey; 2] = [SOL, USDC];
