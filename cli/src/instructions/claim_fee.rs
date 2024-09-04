use crate::instructions::utils::get_bin_array_account_meta_by_bin_range;
use crate::instructions::utils::get_extra_account_metas_for_transfer_hook;

use super::utils::get_or_create_ata;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{
    solana_client::rpc_config::RpcSendTransactionConfig, solana_sdk::signer::Signer, Program,
};
use anchor_lang::prelude::Pubkey;
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::memo;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda::derive_event_authority_pda;
use lb_clmm::utils::remaining_accounts_util::AccountsType;
use lb_clmm::utils::remaining_accounts_util::RemainingAccountsInfo;
use lb_clmm::utils::remaining_accounts_util::RemainingAccountsSlice;
use std::ops::Deref;

pub async fn claim_fee<C: Deref<Target = impl Signer> + Clone>(
    position: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let position_state: PositionV2 = program.account(position).await?;
    let lb_pair_state: LbPair = program.account(position_state.lb_pair).await?;

    let mint_x_owner = program
        .async_rpc()
        .get_account(&lb_pair_state.token_x_mint)
        .await
        .map(|acc| acc.owner)?;

    let mint_y_owner = program
        .async_rpc()
        .get_account(&lb_pair_state.token_y_mint)
        .await
        .map(|acc| acc.owner)?;

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
        mint_x_owner,
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
        mint_y_owner,
    )
    .await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let mut ix_accounts = accounts::ClaimFee2 {
        lb_pair: position_state.lb_pair,
        sender: program.payer(),
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        user_token_x,
        user_token_y,
        event_authority,
        program: lb_clmm::ID,
        token_program_x: mint_x_owner,
        token_program_y: mint_y_owner,
        memo_program: memo::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };

    let transfer_hook_x_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_x_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookX,
        length: transfer_hook_x_accounts.len() as u8,
    });

    let transfer_hook_y_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_y_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookY,
        length: transfer_hook_y_accounts.len() as u8,
    });

    let bin_arrays = get_bin_array_account_meta_by_bin_range(
        position_state.lb_pair,
        position_state.lower_bin_id,
        position_state.upper_bin_id,
    )?;

    ix_accounts.extend(transfer_hook_x_accounts);
    ix_accounts.extend(transfer_hook_y_accounts);
    ix_accounts.extend(bin_arrays);

    let ix_data = instruction::ClaimFee2 {
        min_bin_id: position_state.lower_bin_id,
        max_bin_id: position_state.upper_bin_id,
        remaining_accounts_slice: remaining_accounts_info,
    }
    .data();

    let ix = Instruction {
        data: ix_data,
        accounts: ix_accounts,
        program_id: lb_clmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Claim fee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
