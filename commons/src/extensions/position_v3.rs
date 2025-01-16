use crate::*;
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey};

pub trait PositionV3Extension {
    fn get_bin_array_indexes_bound(&self) -> Result<(i32, i32)>;
    fn get_bin_array_keys_coverage(&self) -> Result<Vec<Pubkey>>;
    fn get_bin_array_accounts_meta_coverage(&self) -> Result<Vec<AccountMeta>>;

    fn get_bin_array_indexes_bound_by_chunk(
        &self,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<(i32, i32)>;

    fn get_bin_array_keys_coverage_by_chunk(
        &self,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<Vec<Pubkey>>;

    fn get_bin_array_accounts_meta_coverage_by_chunk(
        &self,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<Vec<AccountMeta>>;
}

impl PositionV3Extension for PositionV3 {
    fn get_bin_array_indexes_bound(&self) -> Result<(i32, i32)> {
        self.get_bin_array_indexes_bound_by_chunk(self.lower_bin_id, self.upper_bin_id)
    }

    fn get_bin_array_indexes_bound_by_chunk(
        &self,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<(i32, i32)> {
        ensure!(lower_bin_id >= self.lower_bin_id && upper_bin_id <= self.upper_bin_id);
        let lower_bin_array_index = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
        let upper_bin_array_index = BinArray::bin_id_to_bin_array_index(upper_bin_id)?;
        Ok((lower_bin_array_index, upper_bin_array_index))
    }

    fn get_bin_array_keys_coverage(&self) -> Result<Vec<Pubkey>> {
        self.get_bin_array_keys_coverage_by_chunk(self.lower_bin_id, self.upper_bin_id)
    }

    fn get_bin_array_keys_coverage_by_chunk(
        &self,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<Vec<Pubkey>> {
        let (lower_bin_array_index, upper_bin_array_index) =
            self.get_bin_array_indexes_bound_by_chunk(lower_bin_id, upper_bin_id)?;
        let mut bin_array_keys = Vec::new();
        for bin_array_index in lower_bin_array_index..=upper_bin_array_index {
            bin_array_keys.push(derive_bin_array_pda(self.lb_pair, bin_array_index.into()).0);
        }
        Ok(bin_array_keys)
    }

    fn get_bin_array_accounts_meta_coverage(&self) -> Result<Vec<AccountMeta>> {
        self.get_bin_array_accounts_meta_coverage_by_chunk(self.lower_bin_id, self.upper_bin_id)
    }

    fn get_bin_array_accounts_meta_coverage_by_chunk(
        &self,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<Vec<AccountMeta>> {
        let bin_array_keys =
            self.get_bin_array_keys_coverage_by_chunk(lower_bin_id, upper_bin_id)?;
        Ok(bin_array_keys
            .into_iter()
            .map(|key| AccountMeta::new(key, false))
            .collect())
    }
}
