use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid range")]
    InvalidRange,

    #[msg("Invalid lookup timestamp")]
    InvalidLookupTimestamp,
}
