use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

#[constant]
pub const BIN_ARRAY: &[u8] = b"bin_array";

#[constant]
pub const ORACLE: &[u8] = b"oracle";

#[constant]
pub const BIN_ARRAY_BITMAP_SEED: &[u8] = b"bitmap";

#[constant]
pub const PRESET_PARAMETER: &[u8] = b"preset_parameter";

#[constant]
pub const POSITION: &[u8] = b"position";

pub const ILM_BASE_KEY: Pubkey = pubkey!("MFGQxwAmB91SwuYX36okv2Qmdc9aMuHTwWGUrp4AtB1");
