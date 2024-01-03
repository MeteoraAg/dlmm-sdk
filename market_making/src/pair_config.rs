use crate::MarketMakingMode;
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use serde::Deserialize;
use std::fs::File;
use std::io::Read;

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "snake_case")]
pub struct PairConfig {
    pub pair_address: String,
    pub x_amount: u64,
    pub y_amount: u64,
    pub mode: MarketMakingMode,
}

pub fn should_market_making(config: &Vec<PairConfig>) -> bool {
    for pair in config.iter() {
        if pair.mode != MarketMakingMode::ModeView {
            return true;
        }
    }
    return false;
}

pub fn get_pair_config(config: &Vec<PairConfig>, pair_addr: Pubkey) -> PairConfig {
    for pair_config in config.iter() {
        if pair_config.pair_address == pair_addr.to_string() {
            return pair_config.clone();
        }
    }
    return PairConfig::default();
}

pub fn get_config_from_file(path: &str) -> Result<Vec<PairConfig>> {
    // println!("config file {}", env::var("KEEPER_CONFIG_FILE").unwrap());
    let mut file = File::open(path)?;
    let mut data = String::new();
    file.read_to_string(&mut data)?;

    let config: Vec<PairConfig> = serde_json::from_str(&data)?;
    Ok(config)
}

#[cfg(test)]
mod config_test {
    use super::*;
    use std::env;
    #[test]
    fn test_get_get_config_from_file() {
        let mut owned_string: String = env::current_dir()
            .unwrap()
            .into_os_string()
            .into_string()
            .unwrap();
        let borrowed_string: &str = "/src/pair_config.json";
        owned_string.push_str(borrowed_string);

        let config = get_config_from_file(&owned_string).unwrap();
        println!("{:?}", config);
    }
}
