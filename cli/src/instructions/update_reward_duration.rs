use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;
use std::ops::Deref;

#[derive(Debug)]
pub struct UpdateRewardDurationParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub reward_duration: u64,
}

pub async fn update_reward_duration<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateRewardDurationParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let UpdateRewardDurationParams {
        lb_pair,
        reward_index,
        reward_duration,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let active_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id)?;
    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, active_bin_array_idx as i64);

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::UpdateRewardDuration {
        lb_pair,
        admin: program.payer(),
        bin_array,
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::UpdateRewardDuration {
        reward_index,
        new_duration: reward_duration,
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Fund reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
