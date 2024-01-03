use crate::instructions::utils::{get_bin_arrays_for_position, get_or_create_ata};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;
use std::ops::Deref;

#[derive(Debug)]
pub struct ClaimRewardParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub position: Pubkey,
}

pub fn claim_reward<C: Deref<Target = impl Signer> + Clone>(
    params: ClaimRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let ClaimRewardParams {
        lb_pair,
        reward_index,
        position,
    } = params;

    let (reward_vault, _bump) = derive_reward_vault_pda(lb_pair, reward_index);
    let lb_pair_state: LbPair = program.account(lb_pair)?;
    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let user_token_account =
        get_or_create_ata(&program, transaction_config, reward_mint, program.payer())?;

    let [bin_array_lower, bin_array_upper] = get_bin_arrays_for_position(&program, position)?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::ClaimReward {
        bin_array_lower,
        bin_array_upper,
        lb_pair,
        reward_vault,
        reward_mint,
        token_program: anchor_spl::token::ID,
        position,
        user_token_account,
        owner: program.payer(),
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::ClaimReward { reward_index };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Claim reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
