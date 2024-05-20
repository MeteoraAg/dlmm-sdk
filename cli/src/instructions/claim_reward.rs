use crate::instructions::utils::{get_bin_arrays_for_position, get_or_create_ata};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::prelude::AccountMeta;
use anchor_lang::ToAccountMetas;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::dynamic_position::PositionV3;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;
use std::ops::Deref;
#[derive(Debug)]
pub struct ClaimRewardParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub position: Pubkey,
}

pub async fn claim_reward<C: Deref<Target = impl Signer> + Clone>(
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
    let lb_pair_state: LbPair = program.account(lb_pair).await?;
    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let user_token_account =
        get_or_create_ata(&program, transaction_config, reward_mint, program.payer()).await?;

    let [bin_array_lower, bin_array_upper] =
        get_bin_arrays_for_position(&program, position).await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let position_state: PositionV3 = program.account(position).await?;

    let accounts = [
        accounts::ClaimReward {
            lb_pair,
            reward_vault,
            reward_mint,
            token_program: anchor_spl::token::ID,
            position,
            user_token_account,
            sender: program.payer(),
            event_authority,
            program: lb_clmm::ID,
        }
        .to_account_metas(None),
        vec![
            AccountMeta {
                is_signer: false,
                is_writable: true,
                pubkey: bin_array_lower,
            },
            AccountMeta {
                is_signer: false,
                is_writable: true,
                pubkey: bin_array_upper,
            },
        ],
    ]
    .concat();

    let ix = instruction::ClaimReward {
        reward_index,
        min_bin_id: position_state.lower_bin_id,
        max_bin_id: position_state.upper_bin_id,
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Claim reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
