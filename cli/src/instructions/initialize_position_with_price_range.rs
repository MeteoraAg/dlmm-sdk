use crate::*;
use instructions::*;
use rust_decimal::Decimal;

#[derive(Debug, Parser)]
pub struct InitPositionWithPriceRangeParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Lower bound of the price.
    pub lower_price: f64,
    /// Width of the position. Start with 1 until 70.
    pub width: i32,
}

pub async fn execute_initialize_position_with_price_range<
    C: Deref<Target = impl Signer> + Clone,
>(
    params: InitPositionWithPriceRangeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPositionWithPriceRangeParams {
        lb_pair,
        lower_price,
        width,
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

    let params = InitPositionParams {
        lb_pair,
        lower_bin_id,
        width,
    };

    execute_initialize_position(params, program, transaction_config).await
}
