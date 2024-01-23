use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;

use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_spl::associated_token::get_associated_token_address;

use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;

use lb_clmm::state::lb_pair::LbPair;

#[derive(Debug)]
pub struct WithdrawProtocolFeeParams {
    pub lb_pair: Pubkey,
    pub amount_x: u64,
    pub amount_y: u64,
}

pub async fn withdraw_protocol_fee<C: Deref<Target = impl Signer> + Clone>(
    params: WithdrawProtocolFeeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let WithdrawProtocolFeeParams {
        lb_pair,
        amount_x,
        amount_y,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let receiver_token_x =
        get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint);

    let receiver_token_y =
        get_associated_token_address(&program.payer(), &lb_pair_state.token_y_mint);

    let accounts = accounts::WithdrawProtocolFee {
        lb_pair,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_x_program: anchor_spl::token::ID,
        token_y_program: anchor_spl::token::ID,
        fee_owner: program.payer(),
        receiver_token_x,
        receiver_token_y,
    };

    let ix = instruction::WithdrawProtocolFee { amount_x, amount_y };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config).await;

    println!("WithdrawProtocolFee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
