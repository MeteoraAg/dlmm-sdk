use std::{cell::RefCell, collections::HashMap, fs::File, io::LineWriter, path::Path};

use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;
use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
};

use crate::*;
use serde::*;

const PAIR_PROTOCOL_OUTPUT_FILE_NAME: &str = "pair_protocol_fee.csv";
const MINT_PROTOCOL_OUTPUT_FILE_NAME: &str = "mint_protocol_fee.csv";
const CONFIDENCE_LEVEL: &str = "high";
const SELL_PRICE_IMPACT_PCT: f64 = 10.0;

#[derive(Debug, Parser)]
pub struct ExportProtocolFeeParams {
    #[clap(long)]
    pub output_folder_path: String,
    #[clap(long)]
    pub ignore_sell_price_impact_ratio: bool,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct PairRow {
    pub pair_address: String,
    pub token_x: String,
    pub token_y: String,
    pub token_x_amount: f64,
    pub token_y_amount: f64,
    pub token_x_usd_amount: f64,
    pub token_y_usd_amount: f64,
    pub x_excluded: bool,
    pub y_excluded: bool,
    pub total_usd_amount: f64,
}

#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct MintRow {
    pub mint_address: String,
    pub decimal: u8,
    pub amount: f64,
    pub usd_price: f64,
    pub usd_amount: f64,
    pub meet_filtering_condition: bool,
}

fn save_pair_and_mint(
    path: &str,
    pair_records: &HashMap<String, PairRow>,
    mint_records: &HashMap<String, RefCell<MintRow>>,
) -> Result<()> {
    let pair_protocol_csv_file_path = format!("{}/{}", path, PAIR_PROTOCOL_OUTPUT_FILE_NAME);
    let mint_protocol_csv_file_path = format!("{}/{}", path, MINT_PROTOCOL_OUTPUT_FILE_NAME);

    {
        let file = File::create(pair_protocol_csv_file_path)?;
        let file = LineWriter::new(file);
        let mut writer = csv::Writer::from_writer(file);

        for pair_record in pair_records.values() {
            writer.serialize(pair_record.to_owned())?;
        }

        writer.flush()?;
    }

    {
        let file = File::create(mint_protocol_csv_file_path)?;
        let file = LineWriter::new(file);
        let mut writer = csv::Writer::from_writer(file);

        for mint_record in mint_records.values() {
            writer.serialize(mint_record.to_owned())?;
        }

        writer.flush()?;
    }

    Ok(())
}

fn load_pair_from_csv_file(path: &str) -> Result<HashMap<String, PairRow>> {
    let mut pair_records = HashMap::new();
    let path = format!("{}/{}", path, PAIR_PROTOCOL_OUTPUT_FILE_NAME);

    if !Path::new(&path).exists() {
        return Ok(pair_records);
    }

    let mut reader = csv::Reader::from_path(path)?;

    for result in reader.deserialize() {
        let row: PairRow = result?;
        pair_records.insert(row.pair_address.clone(), row);
    }

    Ok(pair_records)
}

fn load_mint_from_csv_file(path: &str) -> Result<HashMap<String, RefCell<MintRow>>> {
    let mut pair_records = HashMap::new();
    let path = format!("{}/{}", path, MINT_PROTOCOL_OUTPUT_FILE_NAME);

    if !Path::new(&path).exists() {
        return Ok(pair_records);
    }

    let mut reader = csv::Reader::from_path(path)?;
    for result in reader.deserialize() {
        let row: MintRow = result?;
        pair_records.insert(row.mint_address.clone(), RefCell::new(row));
    }

    Ok(pair_records)
}

async fn get_all_pair_keys(rpc_client: &RpcClient) -> Result<Vec<Pubkey>> {
    let account_config = RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        data_slice: Some(UiDataSliceConfig {
            offset: 0,
            length: 0,
        }),
        ..Default::default()
    };

    let pair_keys = rpc_client
        .get_program_accounts_with_config(
            &dlmm_interface::ID,
            RpcProgramAccountsConfig {
                filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
                    0,
                    &LB_PAIR_ACCOUNT_DISCM,
                ))]),
                account_config: account_config.clone(),
                ..Default::default()
            },
        )
        .await?
        .into_iter()
        .map(|(key, _)| key)
        .collect::<Vec<_>>();

    Ok(pair_keys)
}

fn show_progress(pair_key_len: usize, unprocessed_pair_key_len: usize) {
    let progress = (pair_key_len - unprocessed_pair_key_len) as f64 * 100.0 / pair_key_len as f64;
    let round_down_progress = ((progress * 100.0) as u64) as f64 / 100.0;
    println!(">>> {}% completed", round_down_progress);
}

async fn get_price_from_jup_v2_with_filtering(
    mint_keys: &[Pubkey],
    confidence_level: &str,
    min_sell_price_impact_pct_100_sol: f64,
    ignore_sell_price_impact_ratio: bool,
) -> Result<HashMap<String, f64>> {
    let mut mint_price_map = HashMap::new();
    let mint_address = mint_keys
        .iter()
        .map(|key| key.to_string())
        .collect::<Vec<_>>();
    let params = mint_address.join(",");

    let url = format!(
        "https://api.jup.ag/price/v2?ids={}&showExtraInfo=true",
        params
    );

    let client = reqwest::Client::new();
    let response: serde_json::Value = client.get(url).send().await?.json().await?;

    let data = response
        .get("data")
        .and_then(|v| v.as_object())
        .context("serde data field not found")?;

    for (mint_address, data) in data {
        if data.is_null() {
            continue;
        }

        let price = data
            .get("price")
            .and_then(|v| v.as_str())
            .and_then(|v| str::parse(v).ok())
            .context("serde price not found")?;

        let extra_info = data
            .get("extraInfo")
            .and_then(|v| v.as_object())
            .context("serde extra info not found")?;

        let mint_confidence_level = extra_info
            .get("confidenceLevel")
            .and_then(|v| v.as_str())
            .context("serde confidence level not found")?;

        let mint_sell_price_impact_pct = extra_info
            .get("depth")
            .and_then(|v| v.get("sellPriceImpactRatio"))
            .and_then(|v| v.get("depth"))
            .and_then(|v| v.get("100"))
            .and_then(|v| v.as_f64());

        if !ignore_sell_price_impact_ratio {
            if let Some(price_impact_pct) = mint_sell_price_impact_pct {
                if price_impact_pct <= min_sell_price_impact_pct_100_sol
                    && mint_confidence_level.eq_ignore_ascii_case(confidence_level)
                {
                    mint_price_map.insert(mint_address.to_owned(), price);
                }
            }
        } else {
            mint_price_map.insert(mint_address.to_owned(), price);
        }
    }

    Ok(mint_price_map)
}

async fn fetch_and_initialize_mint_records(
    mint_records: &mut HashMap<String, RefCell<MintRow>>,
    non_exists_mint_keys: &[Pubkey],
    rpc_client: &RpcClient,
    ignore_sell_price_impact_ratio: bool,
) -> Result<()> {
    for keys in non_exists_mint_keys.chunks(100) {
        let mint_key_with_state = rpc_client
            .get_multiple_accounts(keys)
            .await?
            .into_iter()
            .zip(keys.iter())
            .filter_map(|(account, key)| {
                let mint_state = Mint::try_deserialize(&mut account?.data.as_ref()).ok()?;
                Some((*key, mint_state))
            })
            .collect::<Vec<_>>();

        // Have price only if it meet filtering condition
        let mint_price = get_price_from_jup_v2_with_filtering(
            keys,
            CONFIDENCE_LEVEL,
            SELL_PRICE_IMPACT_PCT,
            ignore_sell_price_impact_ratio,
        )
        .await?;

        for (mint_key, mint_state) in mint_key_with_state {
            let mint_address = mint_key.to_string();

            let mut mint_record = mint_records
                .entry(mint_address.clone())
                .or_default()
                .borrow_mut();

            mint_record.mint_address = mint_address.clone();
            mint_record.decimal = mint_state.decimals;

            if let Some(price) = mint_price.get(&mint_address).copied() {
                mint_record.usd_price = price;
                mint_record.meet_filtering_condition = true;
            }
        }
    }

    Ok(())
}

pub async fn execute_export_protocol_fee_csv(
    params: ExportProtocolFeeParams,
    rpc_client: RpcClient,
) -> Result<()> {
    let ExportProtocolFeeParams {
        output_folder_path,
        ignore_sell_price_impact_ratio,
    } = params;

    let mut pair_records = load_pair_from_csv_file(&output_folder_path)?;
    println!("{} pair records loaded", pair_records.len());

    let mut mint_records = load_mint_from_csv_file(&output_folder_path)?;
    println!("{} mint records loaded", mint_records.len());

    let pair_keys = get_all_pair_keys(&rpc_client).await?;
    println!("{} pairs found", pair_keys.len());

    let unprocessed_pair_keys = pair_keys
        .clone()
        .into_iter()
        .filter(|key| !pair_records.contains_key(&key.to_string()))
        .collect::<Vec<_>>();

    println!("{} unprocessed pairs", unprocessed_pair_keys.len());

    let pair_key_len = pair_keys.len();
    let mut unprocessed_pair_key_len = unprocessed_pair_keys.len();

    show_progress(pair_key_len, unprocessed_pair_key_len);

    for keys in unprocessed_pair_keys.chunks(100) {
        let pair_with_key = rpc_client
            .get_multiple_accounts(keys)
            .await?
            .into_iter()
            .zip(keys.iter())
            .filter_map(|(account, key)| {
                let pair_state = LbPairAccount::deserialize(&account?.data).ok()?.0;
                Some((*key, pair_state))
            })
            .collect::<Vec<_>>();

        let unique_mints = pair_with_key
            .iter()
            .flat_map(|(_key, pair_state)| [pair_state.token_x_mint, pair_state.token_y_mint])
            .collect::<Vec<_>>();

        let non_exists_unique_mints = unique_mints
            .into_iter()
            .filter(|mint_key| !mint_records.contains_key(&mint_key.to_string()))
            .collect::<Vec<_>>();

        fetch_and_initialize_mint_records(
            &mut mint_records,
            &non_exists_unique_mints,
            &rpc_client,
            ignore_sell_price_impact_ratio,
        )
        .await?;

        for (key, pair_state) in pair_with_key {
            let x_mint_str = pair_state.token_x_mint.to_string();
            let y_mint_str = pair_state.token_y_mint.to_string();

            let mut mint_x_row = mint_records
                .get(&x_mint_str)
                .context("mint x not found")?
                .borrow_mut();

            let mut mint_y_row = mint_records
                .get(&y_mint_str)
                .context("mint y not found")?
                .borrow_mut();

            let mint_x_to_ui_price_multiplier = 10.0f64.powi(mint_x_row.decimal.into());
            let mint_y_to_ui_price_multiplier = 10.0f64.powi(mint_y_row.decimal.into());

            let token_x_amount =
                pair_state.protocol_fee.amount_x as f64 / mint_x_to_ui_price_multiplier;
            let token_y_amount =
                pair_state.protocol_fee.amount_y as f64 / mint_y_to_ui_price_multiplier;

            let token_x_usd_amount = token_x_amount * mint_x_row.usd_price;
            let token_y_usd_amount = token_y_amount * mint_y_row.usd_price;

            let pair_row = PairRow {
                pair_address: key.to_string(),
                token_x: pair_state.token_x_mint.to_string(),
                token_y: pair_state.token_y_mint.to_string(),
                token_x_amount,
                token_y_amount,
                token_x_usd_amount,
                token_y_usd_amount,
                x_excluded: !mint_x_row.meet_filtering_condition,
                y_excluded: !mint_y_row.meet_filtering_condition,
                total_usd_amount: token_x_usd_amount + token_y_usd_amount,
            };

            mint_x_row.amount += token_x_amount;
            mint_y_row.amount += token_y_amount;

            mint_x_row.usd_amount += token_x_usd_amount;
            mint_y_row.usd_amount += token_y_usd_amount;

            pair_records.insert(pair_row.pair_address.clone(), pair_row);
        }

        save_pair_and_mint(&output_folder_path, &pair_records, &mint_records)?;

        unprocessed_pair_key_len -= keys.len();
        show_progress(pair_key_len, unprocessed_pair_key_len);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[tokio::test]
    async fn test_get_rice_from_jup_v2() {
        let addresses = [
            "oreoN2tQbHXVaZsr3pf66A48miqcBXCDJozganhEJgz",
            "So11111111111111111111111111111111111111112",
            "2EdzVZ8BoJcNHWLh5qW1LtoGJsDGmNvacWZVjsV4h2XB",
        ];
        let keys = addresses
            .iter()
            .map(|address| Pubkey::from_str(address).unwrap())
            .collect::<Vec<_>>();

        let price = get_price_from_jup_v2_with_filtering(&keys, "high", 10.0, false)
            .await
            .unwrap();

        println!("price: {:#?}", price);
    }
}
