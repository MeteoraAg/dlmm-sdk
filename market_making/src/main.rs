pub mod bin_array_manager;
pub mod core;
pub mod pair_config;
pub mod router;
pub mod state;
pub mod utils;

use crate::pair_config::*;
use crate::state::*;
use crate::utils::*;

use anchor_client::solana_client::nonblocking::rpc_client::*;
use anchor_client::solana_sdk::pubkey::*;
use anchor_client::solana_sdk::signature::*;
use anchor_client::solana_sdk::*;
use anchor_client::*;
use solana_account_decoder::*;

use anyhow::*;
use commons::extensions::*;
use commons::pda::*;
use commons::rpc_client_extension::*;
use commons::*;
use dlmm_interface::*;

use serde::*;
use solana_client::rpc_config::*;

use clap::Parser;
use core::Core;
use hyper::Server;
use router::router;
use routerify::RouterService;
use std::convert::Into;
use std::fmt::Debug;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

#[macro_use]
extern crate log;

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

impl FromStr for MarketMakingMode {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "moderight" => Ok(MarketMakingMode::ModeRight),
            "modeleft" => Ok(MarketMakingMode::ModeLeft),
            "modeboth" => Ok(MarketMakingMode::ModeBoth),
            "modeview" => Ok(MarketMakingMode::ModeView),
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
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init();

    let Args {
        provider,
        wallet,
        user_public_key,
        config_file,
    } = Args::parse();

    let config = get_config_from_file(&config_file)?;
    let wallet = wallet.and_then(|path| read_keypair_file(path).ok());

    let user_wallet = if should_market_making(&config) {
        wallet.as_ref().context("Require keypair")?.pubkey()
    } else {
        user_public_key.unwrap()
    };

    let core = Core {
        provider,
        wallet: wallet.map(Arc::new),
        owner: user_wallet,
        config: config.clone(),
        state: Arc::new(Mutex::new(AllPosition::new(&config))),
    };

    // init some state
    core.refresh_state().await.unwrap();
    core.fetch_token_info().await.unwrap();

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
                if let Err(err) = core.refresh_state().await {
                    error!("refresh_state err {}", err)
                };
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
                    if let Err(err) = core.check_shift_price_range().await {
                        error!("check shift price err {}", err)
                    }
                }
            });
            handles.push(handle);
        }
    }

    let router = router(core);

    let service = RouterService::new(router).unwrap();

    let addr = ([0, 0, 0, 0], 8080).into();

    let server = Server::bind(&addr).serve(service);

    server.await.unwrap();

    for handle in handles {
        handle.await.unwrap();
    }

    Ok(())
}
