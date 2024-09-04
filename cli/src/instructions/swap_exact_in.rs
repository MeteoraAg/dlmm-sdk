use std::collections::HashMap;
use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;

use anchor_client::solana_sdk::clock::Clock;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::solana_sdk::sysvar::SysvarId;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::AccountDeserialize;
use anchor_spl::associated_token::get_associated_token_address;

use anchor_spl::memo;
use anyhow::*;
use commons::quote::{get_bin_array_pubkeys_for_swap, quote_exact_in};
use lb_clmm::accounts;
use lb_clmm::constants::BASIS_POINT_MAX;
use lb_clmm::instruction;

use lb_clmm::state::bin::BinArray;
use lb_clmm::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;

use anchor_lang::{InstructionData, ToAccountMetas};
use lb_clmm::utils::remaining_accounts_util::{
    AccountsType, RemainingAccountsInfo, RemainingAccountsSlice,
};

use crate::instructions::utils::get_extra_account_metas_for_transfer_hook;

#[derive(Debug)]
pub struct SwapExactInParameters {
    pub lb_pair: Pubkey,
    pub amount_in: u64,
    pub swap_for_y: bool,
}

pub async fn swap<C: Deref<Target = impl Signer> + Clone>(
    params: SwapExactInParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SwapExactInParameters {
        amount_in,
        lb_pair,
        swap_for_y,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

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

    let (user_token_in, user_token_out) = if swap_for_y {
        (
            get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint),
            get_associated_token_address(&program.payer(), &lb_pair_state.token_y_mint),
        )
    } else {
        (
            get_associated_token_address(&program.payer(), &lb_pair_state.token_y_mint),
            get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint),
        )
    };

    let (bitmap_extension_key, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    let bitmap_extension = program
        .account::<BinArrayBitmapExtension>(bitmap_extension_key)
        .await
        .ok();

    let bin_arrays_for_swap = get_bin_array_pubkeys_for_swap(
        lb_pair,
        &lb_pair_state,
        bitmap_extension.as_ref(),
        swap_for_y,
        3,
    )?;

    let bin_arrays = program
        .async_rpc()
        .get_multiple_accounts(&bin_arrays_for_swap)
        .await?
        .into_iter()
        .zip(bin_arrays_for_swap.iter())
        .map(|(account, &key)| {
            let account = account?;
            Some((
                key,
                BinArray::try_deserialize(&mut account.data.as_ref()).ok()?,
            ))
        })
        .collect::<Option<HashMap<Pubkey, BinArray>>>()
        .context("Failed to fetch bin arrays")?;

    let clock = program
        .async_rpc()
        .get_account(&Clock::id())
        .await
        .map(|account| {
            let clock: Clock = bincode::deserialize(account.data.as_ref())?;
            Ok(clock)
        })??;

    let quote = quote_exact_in(
        lb_pair,
        &lb_pair_state,
        amount_in,
        swap_for_y,
        bin_arrays,
        bitmap_extension.as_ref(),
        clock.unix_timestamp as u64,
        clock.slot,
    )?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let mut accounts = accounts::Swap2 {
        lb_pair,
        bin_array_bitmap_extension: bitmap_extension
            .map(|_| bitmap_extension_key)
            .or(Some(lb_clmm::ID)),
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_x_program: mint_x_owner,
        token_y_program: mint_y_owner,
        user: program.payer(),
        user_token_in,
        user_token_out,
        oracle: lb_pair_state.oracle,
        host_fee_in: Some(lb_clmm::ID),
        event_authority,
        program: lb_clmm::ID,
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

    let remaining_accounts = bin_arrays_for_swap
        .into_iter()
        .map(|key| AccountMeta::new(key, false))
        .collect::<Vec<_>>();

    accounts.extend(transfer_hook_x_accounts);
    accounts.extend(transfer_hook_y_accounts);
    accounts.extend(remaining_accounts);

    // 100 bps slippage
    let min_amount_out = quote.amount_out * 9900 / BASIS_POINT_MAX as u64;

    let data = instruction::Swap2 {
        amount_in,
        min_amount_out,
        remaining_accounts_info,
    }
    .data();

    let ix = Instruction {
        program_id: lb_clmm::ID,
        data,
        accounts,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Swap. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
