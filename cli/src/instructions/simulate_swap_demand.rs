use crate::instructions::utils::get_or_create_ata;
use crate::swap;
use crate::SwapParameters;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::state::lb_pair::LbPair;
use rand::Rng;
use std::ops::Deref;
use std::result::Result::Ok;
#[derive(Debug)]
pub struct SimulateSwapDemandParameters {
    pub lb_pair: Pubkey,
    pub x_amount: f64, // ex: 10 jup
    pub y_amount: f64, // ex: 1k jup
    pub side_ratio: u64,
}

pub async fn simulate_swap_demand<C: Deref<Target = impl Signer> + Clone>(
    params: SimulateSwapDemandParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SimulateSwapDemandParameters {
        lb_pair,
        x_amount,
        y_amount,
        side_ratio,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;
    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint).await?;

    get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
    )
    .await?;
    get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
    )
    .await?;

    // random amount
    let mut rng = rand::thread_rng();
    loop {
        let side = rng.gen_range(0..side_ratio);
        if side == 0 {
            // sell side
            println!("try to sell {x_amount} jup");
            let amount_x = x_amount * (10u64.pow(token_mint_base.decimals as u32) as f64);
            let params = SwapParameters {
                amount_in: amount_x.round() as u64,
                lb_pair,
                swap_for_y: true,
            };
            match swap(params, program, transaction_config).await {
                Ok(_) => {}
                Err(err) => {
                    println!("{err}");
                }
            }
        } else {
            // buy side
            println!("try to buy with {y_amount} usd");
            let amount_y = y_amount * (10u64.pow(token_mint_quote.decimals as u32) as f64);

            let params = SwapParameters {
                amount_in: amount_y.round() as u64,
                lb_pair,
                swap_for_y: false,
            };
            match swap(params, program, transaction_config).await {
                Ok(_) => {}
                Err(err) => {
                    println!("{err}");
                }
            }
        }
    }
}
