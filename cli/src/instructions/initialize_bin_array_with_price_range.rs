use crate::*;
use instructions::*;
use rust_decimal::Decimal;

#[derive(Debug)]
pub struct InitBinArrayWithPriceRangeParameters {
    pub lb_pair: Pubkey,
    pub lower_price: f64,
    pub upper_price: f64,
}

pub async fn execute_initialize_bin_array_with_price_range<
    C: Deref<Target = impl Signer> + Clone,
>(
    params: InitBinArrayWithPriceRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Vec<Pubkey>> {
    let InitBinArrayWithPriceRangeParameters {
        lb_pair,
        lower_price,
        upper_price,
    } = params;

    let rpc_client = program.async_rpc();
    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let lower_bin_id = get_id_from_price(
        lb_pair_state.bin_step,
        &Decimal::from_f64_retain(lower_price).context("lower price overflow")?,
        Rounding::Down,
    )
    .context("get_id_from_price overflow")?;

    let upper_bin_id = get_id_from_price(
        lb_pair_state.bin_step,
        &Decimal::from_f64_retain(upper_price).context("upper price overflow")?,
        Rounding::Up,
    )
    .context("get_id_from_price overflow")?;

    let params = InitBinArrayWithBinRangeParameters {
        lb_pair,
        lower_bin_id,
        upper_bin_id,
    };

    execute_initialize_bin_array_with_bin_range(params, program, transaction_config).await
}
