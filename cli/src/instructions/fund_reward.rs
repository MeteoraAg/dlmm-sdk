use crate::instructions::utils::{get_extra_account_metas_for_transfer_hook, get_or_create_ata};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;
use lb_clmm::utils::remaining_accounts_util::{
    AccountsType, RemainingAccountsInfo, RemainingAccountsSlice,
};
use std::ops::Deref;

#[derive(Debug)]
pub struct FundRewardParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub funding_amount: u64,
}

pub async fn fund_reward<C: Deref<Target = impl Signer> + Clone>(
    params: FundRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let FundRewardParams {
        lb_pair,
        reward_index,
        funding_amount,
    } = params;

    let (reward_vault, _bump) = Pubkey::find_program_address(
        &[lb_pair.as_ref(), reward_index.to_le_bytes().as_ref()],
        &lb_clmm::ID,
    );
    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let token_program = program.async_rpc().get_account(&reward_mint).await?.owner;

    let funder_token_account = get_or_create_ata(
        program,
        transaction_config,
        reward_mint,
        program.payer(),
        reward_mint,
    )
    .await?;

    let active_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id)?;
    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, active_bin_array_idx as i64);

    let (event_authority, _bump) = derive_event_authority_pda();

    let mut ix_accounts = accounts::FundReward {
        lb_pair,
        reward_vault,
        reward_mint,
        funder: program.payer(),
        funder_token_account,
        bin_array,
        token_program,
        event_authority,
        program: lb_clmm::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };

    let transfer_hook_reward_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_x_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookReward,
        length: transfer_hook_reward_accounts.len() as u8,
    });

    ix_accounts.extend(transfer_hook_reward_accounts);

    let ix_data = instruction::FundReward {
        reward_index,
        amount: funding_amount,
        carry_forward: true,
        remaining_accounts_info,
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

    println!("Fund reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
