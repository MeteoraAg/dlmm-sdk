pub mod bin_array_manager;
pub mod core;
pub mod pair_config;
pub mod router;
pub mod state;
pub mod utils;
use crate::state::SinglePosition;
use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_client::solana_sdk::signature::{read_keypair_file, Keypair};
use anchor_client::solana_sdk::{
    commitment_config::CommitmentConfig,
    signer::{keypair::*, Signer},
};
use anchor_client::Cluster;
use clap::Parser;
use core::Core;
use hyper::Server;
use log::LevelFilter;
use pair_config::{get_config_from_file, should_market_making};
use router::router;
use routerify::RouterService;
use serde::{Deserialize, Serialize};
use state::AllPosition;
use std::collections::HashMap;
use std::convert::Into;
use std::fmt;
use std::fmt::Debug;
use std::io::Write;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use std::{env, str::FromStr};
use std::{thread, time};

#[macro_use]
extern crate log;

use log::Level;

use tokio::time::interval;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub enum MarketMakingMode {
    ModeRight,
    ModeLeft,
    ModeBoth,
    ModeView,
}

impl Default for MarketMakingMode {
    fn default() -> Self {
        MarketMakingMode::ModeView
    }
}
// impl fmt::Display for MarketMakingMode {
//     fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
//         write!(f, "{}", MarketMakingMode::ModeRight)
//     }
// }

impl FromStr for MarketMakingMode {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "ModeRight" => Ok(MarketMakingMode::ModeRight),
            "ModeLeft" => Ok(MarketMakingMode::ModeLeft),
            "ModeBoth" => Ok(MarketMakingMode::ModeBoth),
            "ModeView" => Ok(MarketMakingMode::ModeView),
            _ => Err(anyhow::Error::msg("cannot get mode")),
        }
    }
}

#[derive(Parser, Debug)]
pub struct Args {
    /// Solana RPC provider. For example: https://api.mainnet-beta.solana.com
    #[clap(long, default_value_t = Cluster::Localnet)]
    provider: Cluster,
    /// Wallet of owner
    #[clap(long)]
    wallet: Option<String>,
    /// Address of owner, only user_public_key or wallet is set, other wise it is panic immediately
    #[clap(long)]
    user_public_key: Option<Pubkey>,
    /// config path
    #[clap(long)]
    config_file: String,
    // /// public key pair address,
    // #[clap(long)]
    // pair_address: Pubkey,
    // /// market making mode, Ex: mr: mode right
    // #[clap(long)]
    // mode: MarketMakingMode,
    // // min amount for mm
    // #[clap(long)]
    // min_x_amount: u64,
    // #[clap(long)]
    // min_y_amount: u64,
}

#[tokio::main(worker_threads = 20)] // TODO figure out why it is blocking in linux
async fn main() {
    env_logger::init();

    let Args {
        provider,
        wallet,
        user_public_key,
        config_file,
    } = Args::parse();

    let config = get_config_from_file(&config_file).unwrap();

    // info!("{:?}", mode);

    let user_wallet = if should_market_making(&config) {
        let wallet =
            read_keypair_file(wallet.clone().unwrap()).expect("Wallet keypair file not found");
        wallet.pubkey()
    } else {
        user_public_key.unwrap()
    };

    let core = Core {
        provider,
        wallet,
        owner: user_wallet,
        config: config.clone(),
        state: Arc::new(Mutex::new(AllPosition::new(&config))),
    };

    // init some state
    core.refresh_state().await.unwrap();
    core.fetch_token_info().unwrap();
    let core = Arc::new(core);
    let mut handles = vec![];
    {
        // crawl epoch down
        let core = core.clone();
        let handle = tokio::spawn(async move {
            let duration = 60; // 1 min
            let mut interval = interval(Duration::from_secs(duration));
            loop {
                interval.tick().await;
                info!("refresh state");
                match core.refresh_state().await {
                    Ok(_) => {}
                    Err(err) => error!("refresh_state err {}", err),
                }
            }
        });
        handles.push(handle);
    }

    if should_market_making(&config) {
        {
            // crawl epoch down
            let core = core.clone();

            // init user ata
            core.init_user_ata().await.unwrap();

            let handle = tokio::spawn(async move {
                let duration = 60; // 1 min
                let mut interval = interval(Duration::from_secs(duration));
                loop {
                    interval.tick().await;
                    info!("check shift price range");
                    match core.check_shift_price_range().await {
                        Ok(_) => {}
                        Err(err) => error!("check shift price err {}", err),
                    }
                }
            });
            handles.push(handle);
        }
    }

    // let mut handles = vec![];

    let router = router(core);

    let service = RouterService::new(router).unwrap();

    let addr = ([0, 0, 0, 0], 8080).into();

    let server = Server::bind(&addr).serve(service);

    server.await.unwrap();

    for handle in handles {
        handle.await.unwrap();
    }
}
