use crate::instructions::utils::{
    get_bin_array_account_meta_by_bin_range, get_bin_arrays_for_position,
    get_extra_account_metas_for_transfer_hook, get_or_create_ata,
};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::{InstructionData, ToAccountMetas};
use anchor_spl::memo;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda::*;
use lb_clmm::utils::remaining_accounts_util::{
    AccountsType, RemainingAccountsInfo, RemainingAccountsSlice,
};
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
    let position_state: PositionV2 = program.account(position).await?;

    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let token_program = program.async_rpc().get_account(&reward_mint).await?.owner;

    let user_token_account = get_or_create_ata(
        program,
        transaction_config,
        reward_mint,
        program.payer(),
        token_program,
    )
    .await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let mut ix_accounts = accounts::ClaimReward2 {
        lb_pair,
        reward_vault,
        reward_mint,
        token_program,
        position,
        user_token_account,
        sender: program.payer(),
        event_authority,
        program: lb_clmm::ID,
        memo_program: memo::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };

    let transfer_hook_reward_accounts =
        get_extra_account_metas_for_transfer_hook(reward_mint, program.async_rpc()).await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookReward,
        length: transfer_hook_reward_accounts.len() as u8,
    });

    let bin_arrays = get_bin_array_account_meta_by_bin_range(
        position_state.lb_pair,
        position_state.lower_bin_id,
        position_state.upper_bin_id,
    )?;

    ix_accounts.extend(transfer_hook_reward_accounts);
    ix_accounts.extend(bin_arrays);

    let ix_data = instruction::ClaimReward2 {
        reward_index,
        remaining_accounts_info,
        min_bin_id: position_state.lower_bin_id,
        max_bin_id: position_state.upper_bin_id,
    }
    .data();

    let ix = Instruction {
        program_id: lb_clmm::ID,
        accounts: ix_accounts,
        data: ix_data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Claim reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
