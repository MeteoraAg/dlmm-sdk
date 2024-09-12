use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;

use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_spl::associated_token::get_associated_token_address;

use anchor_spl::memo;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;

use lb_clmm::state::lb_pair::LbPair;

use anchor_lang::{InstructionData, ToAccountMetas};
use lb_clmm::utils::remaining_accounts_util::{
    AccountsType, RemainingAccountsInfo, RemainingAccountsSlice,
};

use crate::instructions::utils::get_extra_account_metas_for_transfer_hook;

#[derive(Debug)]
pub struct WithdrawProtocolFeeParams {
    pub lb_pair: Pubkey,
    pub amount_x: u64,
    pub amount_y: u64,
}

pub async fn withdraw_protocol_fee<C: Deref<Target = impl Signer> + Clone>(
    params: WithdrawProtocolFeeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let WithdrawProtocolFeeParams {
        lb_pair,
        amount_x,
        amount_y,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let token_programs = program
        .async_rpc()
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?
        .into_iter()
        .map(|account| Some(account?.owner))
        .collect::<Option<Vec<Pubkey>>>()
        .context("Missing token mint account")?;

    let [token_x_program, token_y_program] = token_programs.as_slice() else {
        bail!("Missing token program accounts");
    };

    let receiver_token_x =
        get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint);

    let receiver_token_y =
        get_associated_token_address(&program.payer(), &lb_pair_state.token_y_mint);

    let mut accounts = accounts::WithdrawProtocolFee {
        lb_pair,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_x_program: *token_x_program,
        token_y_program: *token_y_program,
        fee_owner: program.payer(),
        receiver_token_x,
        receiver_token_y,
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

    accounts.extend(transfer_hook_x_accounts);
    accounts.extend(transfer_hook_y_accounts);

    let data = instruction::WithdrawProtocolFee {
        amount_x,
        amount_y,
        remaining_accounts_info,
    }
    .data();

    let ix = Instruction {
        accounts,
        data,
        program_id: lb_clmm::ID,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("WithdrawProtocolFee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
