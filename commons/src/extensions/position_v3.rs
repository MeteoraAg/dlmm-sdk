use crate::*;
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey};

pub trait PositionV3Extension {
    fn get_bin_array_indexes_coverage(&self) -> Result<(i32, i32)>;
    fn get_bin_array_keys_coverage(&self) -> Result<Vec<Pubkey>>;
    fn get_bin_array_accounts_meta_coverage(&self) -> Result<Vec<AccountMeta>>;
}

impl PositionV3Extension for PositionV3 {
    fn get_bin_array_indexes_coverage(&self) -> Result<(i32, i32)> {
        let lower_bin_array_index = BinArray::bin_id_to_bin_array_index(self.lower_bin_id)?;
        let upper_bin_array_index = BinArray::bin_id_to_bin_array_index(self.upper_bin_id)?;
        Ok((lower_bin_array_index, upper_bin_array_index))
    }

    fn get_bin_array_keys_coverage(&self) -> Result<Vec<Pubkey>> {
        let (lower_bin_array_index, upper_bin_array_index) =
            self.get_bin_array_indexes_coverage()?;
        let mut bin_array_keys = Vec::new();
        for bin_array_index in lower_bin_array_index..=upper_bin_array_index {
            bin_array_keys.push(derive_bin_array_pda(self.lb_pair, bin_array_index.into()).0);
        }
        Ok(bin_array_keys)
    }

    fn get_bin_array_accounts_meta_coverage(&self) -> Result<Vec<AccountMeta>> {
        let bin_array_keys = self.get_bin_array_keys_coverage()?;
        Ok(bin_array_keys
            .into_iter()
            .map(|key| AccountMeta::new(key, false))
            .collect())
    }
}
