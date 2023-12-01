use anchor_lang::prelude::*;

#[zero_copy]
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Observation {
    /// Cumulative active bin ID
    pub cumulative_active_bin_id: i128,
    /// Observation sample created timestamp
    pub created_at: i64,
    /// Observation sample last updated timestamp
    pub last_updated_at: i64,
}

#[account(zero_copy)]
#[derive(Default, Debug)]
pub struct Oracle {
    /// Index of latest observation slot
    pub idx: u64,
    /// Size of active sample. Active sample is initialized observation.
    pub active_size: u64,
    /// Number of observations
    pub length: u64,
}
