use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::signer::Signer;
use anchor_client::Program;
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use std::ops::Deref;

pub async fn toggle_pool_status<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let accounts = accounts::TogglePairStatus {
        admin: program.payer(),
        lb_pair,
    };

    let ix = instruction::TogglePairStatus {};

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config).await;

    println!("Toggle pool status. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
