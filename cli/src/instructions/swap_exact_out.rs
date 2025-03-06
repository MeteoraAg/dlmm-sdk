use std::collections::HashMap;

use anchor_spl::associated_token::get_associated_token_address;
use solana_sdk::{clock::Clock, sysvar::SysvarId};

use crate::*;

#[derive(Debug, Parser)]
pub struct SwapExactOutParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Amount of token to be buy.
    pub amount_out: u64,
    /// Buy direction. true = buy token Y, false = buy token X.
    #[clap(long)]
    pub swap_for_y: bool,
}

pub async fn execute_swap_exact_out<C: Deref<Target = impl Signer> + Clone>(
    params: SwapExactOutParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SwapExactOutParams {
        amount_out,
        lb_pair,
        swap_for_y,
    } = params;

    let rpc_client = program.async_rpc();
    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

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

    let bitmap_extension = rpc_client
        .get_account_and_deserialize(&bitmap_extension_key, |account| {
            Ok(BinArrayBitmapExtensionAccount::deserialize(&account.data)?.0)
        })
        .await
        .ok();

    let bin_arrays_for_swap = get_bin_array_pubkeys_for_swap(
        lb_pair,
        &lb_pair_state,
        bitmap_extension.as_ref(),
        swap_for_y,
        3,
    )?;

    let bin_arrays = rpc_client
        .get_multiple_accounts(&bin_arrays_for_swap)
        .await?
        .into_iter()
        .zip(bin_arrays_for_swap.iter())
        .map(|(account, &key)| {
            let account = account?;
            Some((
                key,
                BinArrayAccount::deserialize(account.data.as_ref()).ok()?.0,
            ))
        })
        .collect::<Option<HashMap<Pubkey, BinArray>>>()
        .context("Failed to fetch bin arrays")?;

    let clock = rpc_client.get_account(&Clock::id()).await.map(|account| {
        let clock: Clock = bincode::deserialize(account.data.as_ref())?;
        Ok(clock)
    })??;

    let mut mint_accounts = rpc_client
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?;

    let mint_x_account = mint_accounts[0]
        .take()
        .context("Failed to fetch mint account")?;
    let mint_y_account = mint_accounts[1]
        .take()
        .context("Failed to fetch mint account")?;

    let quote = quote_exact_out(
        lb_pair,
        &lb_pair_state,
        amount_out,
        swap_for_y,
        bin_arrays,
        bitmap_extension.as_ref(),
        &clock,
        &mint_x_account,
        &mint_y_account,
    )?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts: [AccountMeta; SWAP_EXACT_OUT2_IX_ACCOUNTS_LEN] = SwapExactOut2Keys {
        lb_pair,
        bin_array_bitmap_extension: bitmap_extension
            .map(|_| bitmap_extension_key)
            .unwrap_or(dlmm_interface::ID),
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
        host_fee_in: dlmm_interface::ID,
        event_authority,
        program: dlmm_interface::ID,
        memo_program: spl_memo::ID,
    }
    .into();

    let in_amount = quote.amount_in + quote.fee;
    // 100 bps slippage
    let max_in_amount = in_amount * 10100 / BASIS_POINT_MAX as u64;

    let data = SwapExactOutIxData(SwapExactOutIxArgs {
        out_amount: amount_out,
        max_in_amount,
    })
    .try_to_vec()?;

    let remaining_accounts = bin_arrays_for_swap
        .into_iter()
        .map(|key| AccountMeta::new(key, false))
        .collect::<Vec<_>>();

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let swap_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(swap_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Swap. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
