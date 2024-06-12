use std::collections::HashMap;
use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;

use anchor_client::solana_sdk::clock::Clock;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::sysvar::SysvarId;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::AccountDeserialize;
use anchor_spl::associated_token::get_associated_token_address;

use anyhow::*;
use commons::quote::{get_bin_array_pubkeys_for_swap, quote_exact_in};
use lb_clmm::accounts;
use lb_clmm::constants::BASIS_POINT_MAX;
use lb_clmm::instruction;

use lb_clmm::state::bin::BinArray;
use lb_clmm::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;

#[derive(Debug)]
pub struct SwapWithPriceImpactParameters {
    pub lb_pair: Pubkey,
    pub amount_in: u64,
    pub swap_for_y: bool,
    pub price_impact_bps: u16,
}

pub async fn swap_with_price_impact<C: Deref<Target = impl Signer> + Clone>(
    params: SwapWithPriceImpactParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SwapWithPriceImpactParameters {
        amount_in,
        lb_pair,
        swap_for_y,
        price_impact_bps,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

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

    let current_timestamp =
        program
            .async_rpc()
            .get_account(&Clock::id())
            .await
            .map(|account| {
                let clock: Clock = bincode::deserialize(account.data.as_ref())?;
                Ok(clock.unix_timestamp)
            })??;

    let quote = quote_exact_in(
        lb_pair,
        &lb_pair_state,
        amount_in,
        swap_for_y,
        bin_arrays,
        bitmap_extension.as_ref(),
        current_timestamp as u64,
    )?;

    let (event_authority, _bump) =
        Pubkey::find_program_address(&[b"__event_authority"], &lb_clmm::ID);

    let accounts = accounts::Swap {
        lb_pair,
        bin_array_bitmap_extension: bitmap_extension
            .map(|_| bitmap_extension_key)
            .or(Some(lb_clmm::ID)),
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_x_program: anchor_spl::token::ID,
        token_y_program: anchor_spl::token::ID,
        user: program.payer(),
        user_token_in,
        user_token_out,
        oracle: lb_pair_state.oracle,
        host_fee_in: Some(lb_clmm::ID),
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::SwapWithPriceImpact {
        amount_in,
        active_id: Some(lb_pair_state.active_id),
        max_price_impact_bps: price_impact_bps,
    };

    let remaining_accounts = bin_arrays_for_swap
        .into_iter()
        .map(|key| AccountMeta::new(key, false))
        .collect::<Vec<_>>();

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .accounts(accounts)
        .accounts(remaining_accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Swap. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
