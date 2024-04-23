#[cfg(not(feature = "localnet"))]
use crate::constants::SAMPLE_LIFETIME;
use crate::errors::LBError;
use crate::{constants::DEFAULT_OBSERVATION_LENGTH, math::safe_math::SafeMath};
use anchor_lang::prelude::*;
use std::cell::RefMut;

#[cfg(not(feature = "localnet"))]
fn get_sample_lifetime() -> i64 {
    SAMPLE_LIFETIME as i64
}

#[cfg(feature = "localnet")]
fn get_sample_lifetime() -> i64 {
    5
}

/// Extension trait for loading dynamic-sized data in a zero-copy oracle account.
pub trait OracleContentLoader<'info> {
    fn load_content_mut<'a>(&'a self) -> Result<DynamicOracle<'a>>;
    fn load_content_init<'a>(&'a self) -> Result<DynamicOracle<'a>>;
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

    pub fn reset(&mut self) {
        self.cumulative_active_bin_id = 0;
        self.created_at = 0;
        self.last_updated_at = 0;
    }

    /// Calculate cumulative_active_bin_id += active_id * delta_seconds
    pub fn accumulate_active_bin_id(&self, active_id: i32, current_timestamp: i64) -> Result<i128> {
        if self.initialized() {
            let delta = current_timestamp.safe_sub(self.last_updated_at)?;
            let cumulative_active_bin_id = Into::<i128>::into(active_id).safe_mul(delta.into())?;

            Ok(self
                .cumulative_active_bin_id
                .safe_add(cumulative_active_bin_id)?)
        } else {
            Ok(active_id.into())
        }
    }

    /// Calculate the timestamp for the next observation sampling
    pub fn compute_next_sampling_timestamp(&self) -> Option<i64> {
        if self.initialized() {
            self.created_at.checked_add(get_sample_lifetime())
        } else {
            None
        }
    }

    /// Update the observation sample
    pub fn update(&mut self, cumulative_active_bin_id: i128, current_timestamp: i64) {
        self.cumulative_active_bin_id = cumulative_active_bin_id;
        self.last_updated_at = current_timestamp;

        if !self.initialized() {
            self.created_at = current_timestamp;
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
    pub fn init(&mut self) {
        self.length = DEFAULT_OBSERVATION_LENGTH;
    }

    pub fn increase_length(&mut self, length_to_increase: u64) -> Result<()> {
        self.length = self.length.safe_add(length_to_increase)?;
        Ok(())
    }

    pub fn space(observation_length: u64) -> usize {
        8 + std::mem::size_of::<Oracle>()
            + observation_length as usize * std::mem::size_of::<Observation>()
    }

    pub fn new_space(
        length_to_add: u64,
        account_loader: &AccountLoader<'_, Oracle>,
    ) -> Result<usize> {
        let oracle = account_loader.load()?;
        Ok(Oracle::space(oracle.length + length_to_add))
    }

    pub fn metadata_len() -> usize {
        8 + std::mem::size_of::<Oracle>()
    }
}

/// An oracle struct loaded with dynamic sized data type
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

    /// Return indication whether the oracle have any observation samples
    fn is_initial_sampling(metadata: &Oracle) -> bool {
        metadata.active_size == 0
    }

    /// Return the latest observation sample
    pub fn get_latest_sample_mut<'dyo>(&'dyo mut self) -> Option<&'dyo mut Observation> {
        if Self::is_initial_sampling(&self.metadata) {
            return None;
        }
        Some(&mut self.observations[self.metadata.idx as usize])
    }

    pub fn get_latest_sample<'dyo>(&'dyo self) -> Option<&'dyo Observation> {
        if Self::is_initial_sampling(&self.metadata) {
            return None;
        }
        Some(&self.observations[self.metadata.idx as usize])
    }

    /// Return the earliest observation sample
    pub fn get_earliest_sample<'dyo>(&'dyo self) -> Option<&'dyo Observation> {
        if Self::is_initial_sampling(&self.metadata) {
            return None;
        }
        let next_idx = Self::next_idx(
            self.metadata.idx as usize,
            self.metadata.active_size as usize,
        )?;
        Some(&self.observations[next_idx])
    }

    /// Get next observation and reset to empty value
    fn next_reset<'dyo>(&'dyo mut self) -> Option<&'dyo mut Observation> {
        let next_idx = Self::next_idx(self.metadata.idx as usize, self.metadata.length as usize)?;
        self.metadata.idx = next_idx as u64;

        let next_sample = &mut self.observations[next_idx];

        if !next_sample.initialized() {
            self.metadata.active_size = std::cmp::min(
                self.metadata.active_size.checked_add(1)?,
                self.metadata.length,
            );
        }

        next_sample.reset();
        Some(next_sample)
    }

    /// Update existing observation sample / create a new observation sample based on sample lifetime expiration
    pub fn update(&mut self, active_id: i32, current_timestamp: i64) -> Result<()> {
        if Self::is_initial_sampling(&self.metadata) {
            self.metadata.active_size += 1;
        }

        let mut latest_sample = self
            .get_latest_sample_mut()
            .ok_or_else(|| LBError::InsufficientSample)?; // Unreachable !

        let cumulative_active_bin_id =
            latest_sample.accumulate_active_bin_id(active_id, current_timestamp)?;

        if let Some(next_sampling_timestamp) = latest_sample.compute_next_sampling_timestamp() {
            if current_timestamp >= next_sampling_timestamp {
                latest_sample = self.next_reset().ok_or_else(|| LBError::MathOverflow)?;
            }
        }
        latest_sample.update(cumulative_active_bin_id, current_timestamp);

        Ok(())
    }
}

fn oracle_account_split<'a, 'info>(
    oracle_al: &'a AccountLoader<'info, Oracle>,
) -> Result<DynamicOracle<'a>> {
    let data = oracle_al.as_ref().try_borrow_mut_data()?;

    let (oracle_metadata, observations) = RefMut::map_split(data, |data| {
        let (oracle_bytes, observations_bytes) = data.split_at_mut(Oracle::metadata_len());
        let oracle = bytemuck::from_bytes_mut::<Oracle>(&mut oracle_bytes[8..]);
        let observations = bytemuck::cast_slice_mut::<u8, Observation>(observations_bytes);
        (oracle, observations)
    });

    Ok(DynamicOracle::new(oracle_metadata, observations))
}

impl<'info> OracleContentLoader<'info> for AccountLoader<'info, Oracle> {
    fn load_content_mut<'a>(&'a self) -> Result<DynamicOracle<'a>> {
        {
            // Re-use anchor internal validation such as discriminator check
            self.load_mut()?;
        }
        oracle_account_split(&self)
    }

    fn load_content_init<'a>(&'a self) -> Result<DynamicOracle<'a>> {
        {
            // Re-use anchor internal validation and initialization such as insert of discriminator for new zero copy account
            self.load_init()?;
        }
        oracle_account_split(&self)
    }

    fn load_content<'a>(&'a self) -> Result<DynamicOracle<'a>> {
        {
            // Re-use anchor internal validation and initialization such as insert of discriminator for new zero copy account
            self.load()?;
        }
        oracle_account_split(&self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::SAMPLE_LIFETIME;
    use rand::Rng;
    use std::cell::RefCell;

    struct OracleAccount<const N: usize> {
        oracle: RefCell<Oracle>,
        observations: RefCell<[Observation; N]>,
    }

    impl<const N: usize> OracleAccount<N> {
        fn dynamic_oracle(&self) -> DynamicOracle<'_> {
            DynamicOracle::new(self.oracle.borrow_mut(), self.observations.borrow_mut())
        }

        fn increase_length<const M: usize>(self) -> OracleAccount<M> {
            let extended_oracle_account = setup_oracle_account::<M>();

            {
                let metadata = self.oracle.borrow();
                let mut extended_metadata = extended_oracle_account.oracle.borrow_mut();
                extended_metadata.idx = metadata.idx;
                extended_metadata.length = M as u64;
            }

            {
                let observations = self.observations.borrow();
                let mut extended_observations = extended_oracle_account.observations.borrow_mut();

                for (idx, observation) in observations.iter().enumerate() {
                    let new_observation = &mut extended_observations[idx];
                    new_observation.cumulative_active_bin_id = observation.cumulative_active_bin_id;
                    new_observation.created_at = observation.created_at;
                    new_observation.last_updated_at = observation.last_updated_at;
                }
            }

            extended_oracle_account
        }
    }

    fn setup_oracle_account<const N: usize>() -> OracleAccount<N> {
        OracleAccount {
            oracle: RefCell::new(Oracle {
                idx: 0,
                active_size: 0,
                length: N as u64,
            }),
            observations: RefCell::new([Observation::default(); N]),
        }
    }

    #[test]
    fn test_dynamic_oracle_samples_in_ascending_order() {
        const SIZE: usize = 100;
        let mut current_timestamp = 1698225292;
        let mut active_id = 5555;

        let oracle_account = setup_oracle_account::<SIZE>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        let mut rng = rand::thread_rng();
        let circular_count = rng.gen_range(1, 10);
        let record_per_iteration = rng.gen_range(SIZE, SIZE + 20);

        for _ in 0..=circular_count {
            for _ in 0..=record_per_iteration {
                let timestamp_elapsed = rng.gen_range(5, 300);
                let active_id_moved = rng.gen_range(-10, 10);
                current_timestamp += timestamp_elapsed;
                active_id += active_id_moved;
                assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
            }
        }

        let mut start_idx = dynamic_oracle.metadata.idx;

        for _ in 0..SIZE - 1 {
            let sample_cur = &dynamic_oracle.observations[start_idx as usize];
            start_idx = if start_idx == 0 {
                dynamic_oracle.metadata.length - 1
            } else {
                start_idx - 1
            };
            let sample_prev = &dynamic_oracle.observations[start_idx as usize];
            assert!(sample_cur.last_updated_at > sample_prev.last_updated_at);
        }
    }

    #[test]
    fn test_dynamic_oracle_update_extendable_circular() {
        let created_timestamp = 1698225292;
        let mut current_timestamp = created_timestamp;
        let active_id = 5555;

        let oracle_account = setup_oracle_account::<2>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        current_timestamp += SAMPLE_LIFETIME as i64;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 0);

        current_timestamp += SAMPLE_LIFETIME as i64;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 1);

        drop(dynamic_oracle);

        let oracle_account = oracle_account.increase_length::<5>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        for i in 2..5 {
            current_timestamp += SAMPLE_LIFETIME as i64;
            assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
            assert_eq!(dynamic_oracle.metadata.idx, i);
        }

        current_timestamp += SAMPLE_LIFETIME as i64;
        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 0);
    }

    #[test]
    fn test_dynamic_oracle_get_earliest_sample_mut() {
        let current_timestamp = 1698225292;
        let active_id = 5555;

        let oracle_account = setup_oracle_account::<2>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        let timepoint_0 = current_timestamp;
        assert!(dynamic_oracle.update(active_id, timepoint_0).is_ok());

        let timepoint_1 = timepoint_0 + SAMPLE_LIFETIME as i64;
        assert!(dynamic_oracle.update(active_id, timepoint_1).is_ok());

        // Timepoint 2 overwrite timepoint 0
        let timepoint_2 = timepoint_1 + SAMPLE_LIFETIME as i64;
        assert!(dynamic_oracle.update(active_id, timepoint_2).is_ok());

        let earliest_sample = dynamic_oracle.get_earliest_sample().unwrap();
        assert!(earliest_sample.created_at == timepoint_1);
    }

    #[test]
    fn test_dynamic_oracle_get_latest_sample_mut() {
        let mut current_timestamp = 1698225292;
        let active_id = 5555;

        let oracle_account = setup_oracle_account::<2>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        let latest_sample = dynamic_oracle.get_latest_sample_mut().cloned().unwrap();
        assert_eq!(dynamic_oracle.metadata.idx, 0);
        assert_eq!(latest_sample.last_updated_at, current_timestamp);

        current_timestamp += 100;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        let latest_sample = dynamic_oracle.get_latest_sample_mut().cloned().unwrap();
        assert_eq!(dynamic_oracle.metadata.idx, 0);
        assert_eq!(latest_sample.last_updated_at, current_timestamp);

        current_timestamp += SAMPLE_LIFETIME as i64;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        let latest_sample = dynamic_oracle.get_latest_sample_mut().cloned().unwrap();
        assert_eq!(dynamic_oracle.metadata.idx, 1);
        assert_eq!(latest_sample.last_updated_at, current_timestamp);

        current_timestamp += SAMPLE_LIFETIME as i64;
        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        let latest_sample = dynamic_oracle.get_latest_sample_mut().cloned().unwrap();
        assert_eq!(dynamic_oracle.metadata.idx, 0);
        assert_eq!(latest_sample.last_updated_at, current_timestamp);
    }

    #[test]
    fn test_dynamic_oracle_metadata_active_size() {
        let mut current_timestamp = 1698225292;
        let active_id = 5555;

        let oracle_account = setup_oracle_account::<3>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert!(dynamic_oracle.metadata.idx == 0);
        assert!(dynamic_oracle.metadata.active_size == 1);

        current_timestamp += SAMPLE_LIFETIME as i64;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert!(dynamic_oracle.metadata.idx == 1);
        assert!(dynamic_oracle.metadata.active_size == 2);

        current_timestamp += SAMPLE_LIFETIME as i64;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert!(dynamic_oracle.metadata.idx == 2);
        assert!(dynamic_oracle.metadata.active_size == 3);

        current_timestamp += SAMPLE_LIFETIME as i64;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert!(dynamic_oracle.metadata.idx == 0);
        assert!(dynamic_oracle.metadata.active_size == 3);
    }

    #[test]
    fn test_dynamic_oracle_next_reset() {
        let oracle_account = setup_oracle_account::<2>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        {
            let observations = &mut dynamic_oracle.observations;
            let sample_0 = &mut observations[0];
            sample_0.cumulative_active_bin_id = 1;

            let sample_1 = &mut observations[1];
            sample_1.cumulative_active_bin_id = 2;
        }

        for observation in dynamic_oracle.observations.iter() {
            assert!(observation.cumulative_active_bin_id > 0);
        }

        let observation = dynamic_oracle.next_reset().unwrap();
        assert!(observation.cumulative_active_bin_id == 0);
        assert!(dynamic_oracle.metadata.idx == 1);

        let observation = dynamic_oracle.next_reset().unwrap();
        assert!(observation.cumulative_active_bin_id == 0);
        assert!(dynamic_oracle.metadata.idx == 0);
    }

    #[test]
    fn test_dynamic_oracle_update_multiple_samples() {
        let created_timestamp = 1698225292;
        let mut current_timestamp = created_timestamp;
        let active_id = 5555;

        let oracle_account = setup_oracle_account::<2>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 0);

        let sample = dynamic_oracle.get_latest_sample_mut().unwrap();
        assert_eq!(sample.cumulative_active_bin_id, active_id as i128);
        assert_eq!(sample.created_at, created_timestamp);
        assert_eq!(sample.last_updated_at, current_timestamp);

        current_timestamp += SAMPLE_LIFETIME as i64;

        let accumulated_active_id = active_id as i64 * SAMPLE_LIFETIME as i64;
        let cumulative_active_id = sample.cumulative_active_bin_id + accumulated_active_id as i128;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 1);

        let sample = dynamic_oracle.get_latest_sample_mut().unwrap();
        assert_eq!(sample.cumulative_active_bin_id, cumulative_active_id);
        assert_eq!(sample.created_at, current_timestamp);
        assert_eq!(sample.last_updated_at, current_timestamp);

        current_timestamp += SAMPLE_LIFETIME as i64;

        let cumulative_active_id = sample.cumulative_active_bin_id + accumulated_active_id as i128;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 0);

        let sample = dynamic_oracle.get_latest_sample_mut().unwrap();
        assert_eq!(sample.cumulative_active_bin_id, cumulative_active_id);
        assert_eq!(sample.created_at, current_timestamp);
        assert_eq!(sample.last_updated_at, current_timestamp);
    }

    #[test]
    fn test_dynamic_oracle_update_same_sample_if_lifetime_not_expired() {
        let created_timestamp = 1698225292;
        let mut current_timestamp = created_timestamp;
        let mut active_id = 5555;

        let oracle_account = setup_oracle_account::<2>();
        let mut dynamic_oracle = oracle_account.dynamic_oracle();

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        assert_eq!(dynamic_oracle.metadata.idx, 0);

        let sample = dynamic_oracle.get_latest_sample_mut().unwrap();
        assert_eq!(sample.cumulative_active_bin_id, active_id as i128);
        assert_eq!(sample.created_at, created_timestamp);
        assert_eq!(sample.last_updated_at, current_timestamp);

        let delta_seconds = 5;
        let accumulated_active_id = active_id as i64 * delta_seconds;
        let cumulative_active_id = sample.cumulative_active_bin_id + accumulated_active_id as i128;

        current_timestamp += delta_seconds;

        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        active_id += 1;

        assert_eq!(dynamic_oracle.metadata.idx, 0);

        let sample = dynamic_oracle.get_latest_sample_mut().unwrap();
        assert_eq!(sample.cumulative_active_bin_id, cumulative_active_id);
        assert_eq!(sample.created_at, created_timestamp);
        assert_eq!(sample.last_updated_at, current_timestamp);

        let delta_seconds = 10;
        let accumulated_active_id = active_id as i64 * delta_seconds;
        let cumulative_active_id = sample.cumulative_active_bin_id + accumulated_active_id as i128;

        current_timestamp += delta_seconds;
        assert!(dynamic_oracle.update(active_id, current_timestamp).is_ok());
        // active_id += 5;

        assert_eq!(dynamic_oracle.metadata.idx, 0);

        let sample = dynamic_oracle.get_latest_sample_mut().unwrap();
        assert_eq!(sample.cumulative_active_bin_id, cumulative_active_id);
        assert_eq!(sample.created_at, created_timestamp);
        assert_eq!(sample.last_updated_at, current_timestamp);
    }
}
