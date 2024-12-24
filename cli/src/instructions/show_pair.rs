use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use solana_client::{
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};

fn fee_rate_to_fee_pct(fee_rate: u128) -> Option<Decimal> {
    let fee_rate = Decimal::from_u128(fee_rate)?.checked_div(Decimal::from(FEE_PRECISION))?;
    fee_rate.checked_mul(Decimal::ONE_HUNDRED)
}

#[derive(Debug, Parser)]
pub struct ShowPairParams {
    pub lb_pair: Pubkey,
}

pub async fn execute_show_pair<C: Deref<Target = impl Signer> + Clone>(
    params: ShowPairParams,
    program: &Program<C>,
) -> Result<()> {
    let ShowPairParams { lb_pair } = params;
    let rpc_client = program.async_rpc();

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let lb_pair_filter = RpcFilterType::Memcmp(Memcmp::new_base58_encoded(16, &lb_pair.to_bytes()));
    let account_config = RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        ..Default::default()
    };
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![lb_pair_filter]),
        account_config,
        ..Default::default()
    };

    let mut bin_arrays: Vec<(Pubkey, BinArray)> = rpc_client
        .get_program_accounts_with_config(&dlmm_interface::ID, config)
        .await?
        .into_iter()
        .filter_map(|(key, account)| {
            let bin_array = BinArrayAccount::deserialize(&account.data).ok()?;
            Some((key, bin_array.0))
        })
        .collect();

    bin_arrays.sort_by(|a, b| a.1.index.cmp(&b.1.index));

    println!("{:#?}", lb_pair_state);

    for (_, bin_array) in bin_arrays {
        let (mut lower_bin_id, _) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array.index as i32)?;
        for bin in bin_array.bins.iter() {
            let total_amount = bin.amount_x + bin.amount_y;
            if total_amount > 0 {
                println!(
                    "Bin: {}, X: {}, Y: {}",
                    lower_bin_id, bin.amount_x, bin.amount_y
                );
            }
            lower_bin_id += 1;
        }
    }

    let mut accounts = rpc_client
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?;

    let token_x_account = accounts[0].take().context("token_mint_base not found")?;
    let token_y_account = accounts[1].take().context("token_mint_quote not found")?;

    let x_mint = Mint::try_deserialize(&mut token_x_account.data.as_ref())?;
    let y_mint = Mint::try_deserialize(&mut token_y_account.data.as_ref())?;

    let q64x64_price = get_price_from_id(lb_pair_state.active_id, lb_pair_state.bin_step)?;
    let decimal_price_per_lamport =
        q64x64_price_to_decimal(q64x64_price).context("q64x64 price to decimal overflow")?;

    let token_price = price_per_lamport_to_price_per_token(
        decimal_price_per_lamport
            .to_f64()
            .context("Decimal conversion to f64 fail")?,
        x_mint.decimals,
        y_mint.decimals,
    )
    .context("price_per_lamport_to_price_per_token overflow")?;

    let base_fee_rate = fee_rate_to_fee_pct(lb_pair_state.get_total_fee()?)
        .context("get_total_fee convert to percentage overflow")?;
    let variable_fee_rate = fee_rate_to_fee_pct(lb_pair_state.get_variable_fee()?)
        .context("get_total_fee convert to percentage overflow")?;
    let current_fee_rate = fee_rate_to_fee_pct(lb_pair_state.get_total_fee()?)
        .context("get_total_fee convert to percentage overflow")?;

    println!("Current price {}", token_price);
    println!("Base fee rate {}%", base_fee_rate);
    println!("Volatile fee rate {}%", variable_fee_rate);
    println!("Current fee rate {}%", current_fee_rate);

    Ok(())
}
