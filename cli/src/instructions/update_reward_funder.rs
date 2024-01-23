use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::utils::pda::derive_event_authority_pda;

use std::ops::Deref;

#[derive(Debug)]
pub struct UpdateRewardFunderParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub funder: Pubkey,
}

pub async fn update_reward_funder<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateRewardFunderParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let UpdateRewardFunderParams {
        lb_pair,
        reward_index,
        funder,
    } = params;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::UpdateRewardFunder {
        lb_pair,
        admin: program.payer(),
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::UpdateRewardFunder {
        reward_index,
        new_funder: funder,
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config).await;

    println!("Fund reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
