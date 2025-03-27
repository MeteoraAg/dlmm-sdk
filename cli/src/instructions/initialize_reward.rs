use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use lb_clmm::utils::pda::derive_event_authority_pda;
use std::ops::Deref;

use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;

#[derive(Debug)]
pub struct InitializeRewardParams {
    pub lb_pair: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_index: u64,
    pub reward_duration: u64,
    pub funder: Pubkey,
}

pub async fn initialize_reward<C: Deref<Target = impl Signer> + Clone>(
    params: InitializeRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let InitializeRewardParams {
        lb_pair,
        reward_mint,
        reward_index,
        reward_duration,
        funder,
    } = params;

    let (reward_vault, _bump) = Pubkey::find_program_address(
        &[lb_pair.as_ref(), reward_index.to_le_bytes().as_ref()],
        &lb_clmm::ID,
    );

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::InitializeReward {
        lb_pair,
        reward_vault,
        reward_mint,
        admin: program.payer(),
        token_program: anchor_spl::token::ID,
        rent: anchor_client::solana_sdk::sysvar::rent::ID,
        system_program: anchor_client::solana_sdk::system_program::ID,
        event_authority,
        program: lb_clmm::ID,
    };

    let ix: instruction::InitializeReward = instruction::InitializeReward {
        reward_index,
        reward_duration,
        funder,
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize reward. Signature: {signature:#?}");

    signature?;

    Ok(())
}
