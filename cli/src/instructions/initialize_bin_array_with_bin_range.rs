use crate::*;
use instructions::*;

#[derive(Debug, Parser)]
pub struct InitBinArrayWithBinRangeParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Lower bound of the bin range.
    #[clap(long, allow_negative_numbers = true)]
    pub lower_bin_id: i32,
    /// Upper bound of the bin range.
    #[clap(long, allow_negative_numbers = true)]
    pub upper_bin_id: i32,
}

pub async fn execute_initialize_bin_array_with_bin_range<C: Deref<Target = impl Signer> + Clone>(
    params: InitBinArrayWithBinRangeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Vec<Pubkey>> {
    let InitBinArrayWithBinRangeParams {
        lb_pair,
        lower_bin_id,
        upper_bin_id,
    } = params;

    let mut bin_arrays_pubkey = vec![];

    let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
    let upper_bin_array_idx = BinArray::bin_id_to_bin_array_index(upper_bin_id)?;

    for idx in lower_bin_array_idx..=upper_bin_array_idx {
        let params = InitBinArrayParams {
            bin_array_index: idx.into(),
            lb_pair,
        };
        let bin_array_pubkey =
            execute_initialize_bin_array(params, program, transaction_config).await?;
        bin_arrays_pubkey.push(bin_array_pubkey);
    }

    Ok(bin_arrays_pubkey)
}
