use anchor_lang::prelude::declare_program;
use anyhow::*;

#[cfg(feature = "borsh")]
pub mod dlmm {
    use super::*;
    declare_program!(dlmm_borsh);
    pub use dlmm_borsh::*;
}

#[cfg(not(feature = "borsh"))]
pub mod dlmm {
    use super::*;
    declare_program!(dlmm_zc);
    pub use dlmm_zc::*;
}

use dlmm::accounts::*;
use dlmm::types::*;

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
