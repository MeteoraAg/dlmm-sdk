use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;

#[derive(Debug)]
pub struct UpdateFeeOwnerParam {
    pub lb_pair: Pubkey,
    pub fee_owner: Pubkey,
}

pub fn update_fee_owner<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateFeeOwnerParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let UpdateFeeOwnerParam { fee_owner, lb_pair } = params;

    let accounts = accounts::UpdateFeeOwner {
        admin: program.payer(),
        lb_pair,
        new_fee_owner: fee_owner,
    };

    let ix = instruction::UpdateFeeOwner {};

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Add Liquidity. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
