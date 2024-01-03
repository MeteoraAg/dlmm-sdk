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
    pub min_x_amount: u64, // ex: 10 jup
    pub max_x_amount: u64, // ex: 1k jup
    pub min_y_amount: u64, // ex: 10 usdc
    pub max_y_amount: u64, // ex: 1k usdc
    pub side_ratio: u64,
}

pub fn simulate_swap_demand<C: Deref<Target = impl Signer> + Clone>(
    params: SimulateSwapDemandParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SimulateSwapDemandParameters {
        lb_pair,
        min_x_amount,
        min_y_amount,
        max_x_amount,
        max_y_amount,
        side_ratio,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair)?;
    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint)?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint)?;

    // random amount
    let mut rng = rand::thread_rng();
    loop {
        let side = rng.gen_range(0..side_ratio);
        if side == 0 {
            // sell side
            let amount_x = rng.gen_range(min_x_amount..max_x_amount);

            println!("try to sell {amount_x} jup");
            let params = SwapParameters {
                amount_in: amount_x * 10u64.pow(token_mint_base.decimals as u32),
                lb_pair,
                swap_for_y: true,
            };
            match swap(params, &program, transaction_config) {
                Ok(_) => {}
                Err(err) => {
                    println!("{err}");
                }
            }
        } else {
            // buy side
            let amount_y = rng.gen_range(min_y_amount..max_y_amount);
            println!("try to buy with {amount_y} usd");

            let params = SwapParameters {
                amount_in: amount_y * 10u64.pow(token_mint_quote.decimals as u32),
                lb_pair,
                swap_for_y: false,
            };
            match swap(params, &program, transaction_config) {
                Ok(_) => {}
                Err(err) => {
                    println!("{err}");
                }
            }
        }
    }
}
