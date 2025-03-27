use std::ops::Deref;

use crate::instructions::initialize_bin_array::*;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anyhow::*;
use lb_clmm::state::bin::BinArray;

#[derive(Debug)]
pub struct InitBinArrayWithBinRangeParameters {
    pub lb_pair: Pubkey,
    pub lower_bin_id: i32,
    pub upper_bin_id: i32,
}

pub async fn initialize_bin_array_with_bin_range<C: Deref<Target = impl Signer> + Clone>(
    params: InitBinArrayWithBinRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Vec<Pubkey>> {
    let InitBinArrayWithBinRangeParameters {
        lb_pair,
        lower_bin_id,
        upper_bin_id,
    } = params;

    let mut bin_arrays_pubkey = vec![];

    let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
    let upper_bin_array_idx = BinArray::bin_id_to_bin_array_index(upper_bin_id)?;

    for idx in lower_bin_array_idx..=upper_bin_array_idx {
        let params = InitBinArrayParameters {
            bin_array_index: idx.into(),
            lb_pair,
        };
        let bin_array_pubkey = initialize_bin_array(params, program, transaction_config).await?;
        bin_arrays_pubkey.push(bin_array_pubkey);
    }

    Ok(bin_arrays_pubkey)
}
