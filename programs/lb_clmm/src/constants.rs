use anchor_lang::prelude::*;
use anchor_lang::solana_program::{pubkey, pubkey::Pubkey};

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
pub static ALPHA_ACCESS_COLLECTION_MINTS: [Pubkey; 1] =
    [pubkey!("J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w")];

#[cfg(not(feature = "localnet"))]
pub static ALPHA_ACCESS_COLLECTION_MINTS: [Pubkey; 1] =
    [pubkey!("5rwhXUgAAdbVEaFQzAwgrcWwoCqYGzR1Mo2KwUYfbRuS")];

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::math::price_math;
    use crate::state::parameters::StaticParameters;
    pub const PRESET_BIN_STEP: [u16; 12] = [1, 2, 4, 5, 8, 10, 15, 20, 25, 50, 60, 100];

    /// Preset / supported static parameters. These default values are references from Trader Joe by querying trader joe factory.
    /// https://snowtrace.io/address/0x8e42f2F4101563bF679975178e880FD87d3eFd4e
    pub const fn get_preset(bin_step: u16) -> Option<StaticParameters> {
        let params = match bin_step {
            // TODO: enable protocol share back later
            1 => Some(StaticParameters {
                base_factor: 20000,
                filter_period: 10,
                decay_period: 120,
                reduction_factor: 5000,
                variable_fee_control: 2000000,
                // protocol_share: 500,
                protocol_share: 0,
                max_volatility_accumulator: 100000,
                max_bin_id: 436704,
                min_bin_id: -436704,
                _padding: [0u8; 6],
            }),
            2 => Some(StaticParameters {
                base_factor: 15000,
                filter_period: 10,
                decay_period: 120,
                reduction_factor: 5000,
                variable_fee_control: 500000,
                // protocol_share: 1000,
                protocol_share: 0,
                max_bin_id: 218363,
                min_bin_id: -218363,
                max_volatility_accumulator: 250000,
                _padding: [0u8; 6],
            }),
            4 => Some(StaticParameters {
                base_factor: 50000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 120000,
                // protocol_share: 2500,
                protocol_share: 0,
                max_bin_id: 109192,
                min_bin_id: -109192,
                max_volatility_accumulator: 300000,
                _padding: [0u8; 6],
            }),
            5 => Some(StaticParameters {
                base_factor: 8000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 120000,
                // protocol_share: 2500,
                protocol_share: 0,
                max_bin_id: 87358,
                min_bin_id: -87358,
                max_volatility_accumulator: 300000,
                _padding: [0u8; 6],
            }),
            // this preset is included to match with orca pools
            8 => Some(StaticParameters {
                base_factor: 6250,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 120000,
                // protocol_share: 2500,
                protocol_share: 0,
                max_bin_id: 54190,
                min_bin_id: -54190,
                max_volatility_accumulator: 300000,
                _padding: [0u8; 6],
            }),
            10 => Some(StaticParameters {
                base_factor: 10000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 40000,
                // protocol_share: 1000,
                protocol_share: 0,
                max_bin_id: 43690,
                min_bin_id: -43690,
                max_volatility_accumulator: 350000,
                _padding: [0u8; 6],
            }),
            15 => Some(StaticParameters {
                base_factor: 10000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 30000,
                // protocol_share: 1000,
                protocol_share: 0,
                max_bin_id: 29134,
                min_bin_id: -29134,
                max_volatility_accumulator: 350000,
                _padding: [0u8; 6],
            }),
            20 => Some(StaticParameters {
                base_factor: 10000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 20000,
                // protocol_share: 2000,
                protocol_share: 0,
                max_bin_id: 21855,
                min_bin_id: -21855,
                max_volatility_accumulator: 350000,
                _padding: [0u8; 6],
            }),
            25 => Some(StaticParameters {
                base_factor: 10000,
                filter_period: 30,
                decay_period: 600,
                reduction_factor: 5000,
                variable_fee_control: 15000,
                // protocol_share: 2000,
                protocol_share: 0,
                max_bin_id: 17481,
                min_bin_id: -17481,
                max_volatility_accumulator: 350000,
                _padding: [0u8; 6],
            }),
            50 => Some(StaticParameters {
                base_factor: 8000,
                filter_period: 120,
                decay_period: 1200,
                reduction_factor: 5000,
                variable_fee_control: 10000,
                // protocol_share: 2500,
                protocol_share: 0,
                max_bin_id: 8754,
                min_bin_id: -8754,
                max_volatility_accumulator: 250000,
                _padding: [0u8; 6],
            }),
            60 => Some(StaticParameters {
                base_factor: 5000,
                filter_period: 120,
                decay_period: 1200,
                reduction_factor: 5000,
                variable_fee_control: 10000,
                max_volatility_accumulator: 250000,
                min_bin_id: -7299,
                max_bin_id: 7299,
                // protocol_share: 2500,
                protocol_share: 0,
                _padding: [0u8; 6],
            }),
            100 => Some(StaticParameters {
                base_factor: 8000,
                filter_period: 300,
                decay_period: 1200,
                reduction_factor: 5000,
                variable_fee_control: 7500,
                // protocol_share: 2500,
                protocol_share: 0,
                max_bin_id: 4386,
                min_bin_id: -4386,
                max_volatility_accumulator: 150000,
                _padding: [0u8; 6],
            }),
            _ => None,
        };

        // Is it possible to move the checking to compile time ?
        if let Some(params) = &params {
            // Make sure the params stay within the bound. But it result in ugly runtime panic ...
            // This couldn't prevent the team deploy with invalid parameters that causes the program overflow unexpectedly. But, at least it prevent user from creating such pools ...
            // Increasing the bound will increase the bytes needed for fee calculation.
            assert!(params.max_volatility_accumulator <= U24_MAX);
            assert!(params.variable_fee_control <= U24_MAX);
            assert!(params.protocol_share <= MAX_PROTOCOL_SHARE);
        }

        params
    }

    #[test]
    fn test_get_preset() {
        for bin_step in PRESET_BIN_STEP {
            assert!(get_preset(bin_step).is_some());
        }
    }

    #[test]
    fn test_preset_min_max_bin_id() {
        for bin_step in PRESET_BIN_STEP {
            let param = get_preset(bin_step);
            assert!(param.is_some());

            if let Some(param) = param {
                let max_price = price_math::get_price_from_id(param.max_bin_id, bin_step);
                let min_price = price_math::get_price_from_id(param.min_bin_id, bin_step);

                assert!(max_price.is_ok());
                assert!(min_price.is_ok());

                // Bin is not swap-able when the price is u128::MAX, and 1
                assert!(max_price.unwrap() == 170141183460469231731687303715884105727);
                assert!(min_price.unwrap() == 2);
            }
        }
    }
}
