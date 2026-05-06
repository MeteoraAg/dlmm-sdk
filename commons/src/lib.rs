use anchor_lang::prelude::declare_program;
use anyhow::*;
use bytemuck::AnyBitPattern;

declare_program!(dlmm);

use dlmm::accounts::*;
use dlmm::types::*;

/// Decode an anchor account from raw account data bytes.
/// Strips the 8-byte discriminator and reads exactly `size_of::<T>()` bytes.
pub fn pod_read_unaligned_skip_disc<T: AnyBitPattern>(account_data: &[u8]) -> Result<T> {
    let size = std::mem::size_of::<T>();
    ensure!(
        account_data.len() >= 8 + size,
        "account data too short: expected at least {} bytes, got {}",
        8 + size,
        account_data.len()
    );
    Ok(bytemuck::pod_read_unaligned(&account_data[8..8 + size]))
}

pub mod constants;
pub use constants::*;

pub mod conversions;
pub use conversions::*;

pub mod extensions;
pub use extensions::*;

pub mod pda;
pub use pda::*;

pub mod quote;
pub use quote::*;

pub mod seeds;
pub use seeds::*;

pub mod math;
pub use math::*;

pub mod typedefs;
pub use typedefs::*;

pub mod rpc_client_extension;

pub mod account_filters;
pub use account_filters::*;

pub mod token_2022;
pub use token_2022::*;
