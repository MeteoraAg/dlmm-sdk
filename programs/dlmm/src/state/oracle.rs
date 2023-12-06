use std::cell::RefMut;

use anchor_lang::prelude::*;

use crate::errors::LBError;

pub trait OracleContentLoader<'info> {
    fn load_content<'a>(&'a self) -> Result<DynamicOracle<'a>>;
}

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

impl Observation {
    pub fn initialized(&self) -> bool {
        self.created_at > 0 && self.last_updated_at > 0
    }

    /// Calculate cumulative_active_bin_id += active_id * delta_seconds
    pub fn accumulate_active_bin_id(&self, active_id: i32, current_timestamp: i64) -> Result<i128> {
        if self.initialized() {
            let delta = current_timestamp
                .checked_sub(self.last_updated_at)
                .ok_or_else(|| LBError::MathOverflow)?;
            let cumulative_active_bin_id = Into::<i128>::into(active_id)
                .checked_mul(delta.into())
                .ok_or_else(|| LBError::MathOverflow)?;

            Ok(self
                .cumulative_active_bin_id
                .checked_add(cumulative_active_bin_id)
                .ok_or_else(|| LBError::MathOverflow)?)
        } else {
            Ok(active_id.into())
        }
    }
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

impl Oracle {
    pub fn metadata_len() -> usize {
        8 + std::mem::size_of::<Oracle>()
    }
}

#[derive(Debug)]
pub struct DynamicOracle<'a> {
    pub metadata: RefMut<'a, Oracle>,
    pub observations: RefMut<'a, [Observation]>,
}

impl<'a> DynamicOracle<'a> {
    pub fn new(
        metadata: RefMut<'a, Oracle>,
        observations: RefMut<'a, [Observation]>,
    ) -> DynamicOracle<'a> {
        Self {
            observations,
            metadata,
        }
    }

    /// Get wrapping next index
    fn next_idx(idx: usize, bound: usize) -> Option<usize> {
        idx.checked_add(1)?.checked_rem(bound)
    }

    /// Get wrapping prev index
    fn prev_idx(idx: usize, bound: usize) -> Option<usize> {
        if idx == 0 {
            bound.checked_sub(1)
        } else {
            idx.checked_sub(1)
        }
    }

    /// Retrieves two observation samples from the collection. If a sample with the exact lookup timestamp is found,
    /// it returns two identical observations. If not, it returns two samples with timestamps that sandwich the lookup timestamp.
    /// If no matching samples are found, it returns None.
    fn binary_search(&self, lookup_timestamp: i64) -> Option<(&Observation, &Observation)> {
        let metadata_idx = self.metadata.idx as i64;
        let metadata_active_size = self.metadata.active_size as i64;

        let mut last_search_idx = metadata_idx;
        let mut low = 0;
        let mut high = metadata_active_size - 1;

        while low <= high {
            let mid = (low + high) / 2;

            last_search_idx = (metadata_idx + 1 + mid) % metadata_active_size;
            let sample = &self.observations[last_search_idx as usize];

            if lookup_timestamp < sample.last_updated_at {
                high = mid - 1;
            } else if lookup_timestamp > sample.last_updated_at {
                low = mid + 1;
            } else {
                return Some((sample, sample));
            }
        }

        let last_searched_sample = &self.observations[last_search_idx as usize];

        if lookup_timestamp > last_searched_sample.last_updated_at {
            // Last searched sample is the newest; no newer samples exist.
            if last_search_idx == metadata_idx {
                return None;
            }

            let next_idx = Self::next_idx(last_search_idx as usize, metadata_active_size as usize)?;
            let next_sample = &self.observations[next_idx];

            Some((last_searched_sample, next_sample))
        } else {
            // Last searched sample is the earliest; no earlier samples exist.
            if last_search_idx == (metadata_idx + 1) % metadata_active_size {
                return None;
            }

            let prev_idx =
                Self::prev_idx(last_search_idx as usize, self.metadata.active_size as usize)?;
            let prev_sample = &self.observations[prev_idx];

            Some((prev_sample, last_searched_sample))
        }
    }

    /// Return indication whether the oracle have any observation samples
    fn is_initial_sampling(metadata: &Oracle) -> bool {
        metadata.active_size == 0
    }

    fn get_latest_sample<'dyo>(&'dyo self) -> Option<&'dyo Observation> {
        if Self::is_initial_sampling(&self.metadata) {
            return None;
        }
        Some(&self.observations[self.metadata.idx as usize])
    }

    /// Return the earliest observation sample
    fn get_earliest_sample<'dyo>(&'dyo self) -> Option<&'dyo Observation> {
        if Self::is_initial_sampling(&self.metadata) {
            return None;
        }
        let next_idx = Self::next_idx(
            self.metadata.idx as usize,
            self.metadata.active_size as usize,
        )?;
        Some(&self.observations[next_idx])
    }

    /// Returns the sample at the given timestamp. If the timestamp is not in the oracle, it returns the closest sample
    pub fn get_sample(
        &self,
        current_active_id: i32,
        current_timestamp: i64,
        lookup_timestamp: i64,
    ) -> Result<i128> {
        if lookup_timestamp > current_timestamp {
            return Err(LBError::InvalidLookupTimestamp.into());
        }

        let earliest_sample = self
            .get_earliest_sample()
            .ok_or_else(|| LBError::InsufficientSample)?;

        if lookup_timestamp < earliest_sample.last_updated_at {
            return Err(LBError::InvalidLookupTimestamp.into());
        }

        let latest_sample = self
            .get_latest_sample()
            .ok_or_else(|| LBError::InsufficientSample)?;

        if lookup_timestamp >= latest_sample.last_updated_at {
            Ok(latest_sample.accumulate_active_bin_id(current_active_id, lookup_timestamp)?)
        } else {
            let (prev_sample, next_sample) = self
                .binary_search(lookup_timestamp)
                .ok_or_else(|| LBError::InsufficientSample)?;

            Ok(
                interpolate_cumulative_active_bin_id(&prev_sample, &next_sample, lookup_timestamp)
                    .ok_or_else(|| LBError::MathOverflow)?,
            )
        }
    }
}

fn interpolate_cumulative_active_bin_id(
    prev: &Observation,
    next: &Observation,
    lookup_timestamp: i64,
) -> Option<i128> {
    if prev.eq(next) {
        return Some(prev.cumulative_active_bin_id);
    }

    let prev_weight = next.last_updated_at.checked_sub(lookup_timestamp)?;
    let next_weight = lookup_timestamp.checked_sub(prev.last_updated_at)?;

    calculate_weighted_mean(
        prev.cumulative_active_bin_id,
        next.cumulative_active_bin_id,
        prev_weight.into(),
        next_weight.into(),
    )
}

fn calculate_weighted_mean(v0: i128, v1: i128, v0_weight: i128, v1_weight: i128) -> Option<i128> {
    let total_weight = v0_weight.checked_add(v1_weight)?;
    let weighted_v0 = v0.checked_mul(v0_weight)?;
    let weighted_v1 = v1.checked_mul(v1_weight)?;
    weighted_v0
        .checked_add(weighted_v1)?
        .checked_div(total_weight)
}

pub fn load_oracle_content<'a>(data: RefMut<'a, &mut [u8]>) -> DynamicOracle<'a> {
    let (oracle_metadata, observations) = RefMut::map_split(data, |data| {
        let (oracle_bytes, observations_bytes) = data.split_at_mut(Oracle::metadata_len());
        let oracle = bytemuck::from_bytes_mut::<Oracle>(&mut oracle_bytes[8..]);
        let observations = bytemuck::cast_slice_mut::<u8, Observation>(observations_bytes);
        (oracle, observations)
    });

    DynamicOracle::new(oracle_metadata, observations)
}

fn oracle_account_split<'a, 'info>(
    oracle_al: &'a AccountLoader<'info, Oracle>,
) -> Result<DynamicOracle<'a>> {
    let data = oracle_al.as_ref().try_borrow_mut_data()?;
    Ok(load_oracle_content(data))
}

impl<'info> OracleContentLoader<'info> for AccountLoader<'info, Oracle> {
    fn load_content<'a>(&'a self) -> Result<DynamicOracle<'a>> {
        {
            self.load()?;
        }
        oracle_account_split(&self)
    }
}
