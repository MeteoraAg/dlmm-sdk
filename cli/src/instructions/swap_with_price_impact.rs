use crate::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;

#[derive(Debug, Parser)]
pub struct SwapWithPriceImpactParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Amount of token to be sell.
    pub amount_in: u64,
    /// Buy direction. true = buy token Y, false = buy token X.
    #[clap(long)]
    pub swap_for_y: bool,
    /// Allowed price impact in bps.
    pub price_impact_bps: u16,
}

pub async fn execute_swap_with_price_impact<C: Deref<Target = impl Signer> + Clone>(
    params: SwapWithPriceImpactParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SwapWithPriceImpactParams {
        amount_in,
        lb_pair,
        swap_for_y,
        price_impact_bps,
    } = params;

    let rpc_client = program.rpc();
    let lb_pair_state: LbPair = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(bytemuck::pod_read_unaligned(&account.data[8..]))
        })
        .await?;

    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let (user_token_in, user_token_out) = if swap_for_y {
        (
            get_associated_token_address_with_program_id(
                &program.payer(),
                &lb_pair_state.token_x_mint,
                &token_x_program,
            ),
            get_associated_token_address_with_program_id(
                &program.payer(),
                &lb_pair_state.token_y_mint,
                &token_y_program,
            ),
        )
    } else {
        (
            get_associated_token_address_with_program_id(
                &program.payer(),
                &lb_pair_state.token_y_mint,
                &token_y_program,
            ),
            get_associated_token_address_with_program_id(
                &program.payer(),
                &lb_pair_state.token_x_mint,
                &token_x_program,
            ),
        )
    };

    let (bitmap_extension_key, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    let bitmap_extension = rpc_client
        .get_account_and_deserialize(&bitmap_extension_key, |account| {
            Ok(bytemuck::pod_read_unaligned(&account.data[8..]))
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

    let SwapQuoteAccounts {
        lb_pair_state,
        clock,
        mint_x_account,
        mint_y_account,
        bin_arrays,
        bin_array_keys,
    } = fetch_quote_required_accounts(&rpc_client, lb_pair, &lb_pair_state, bin_arrays_for_swap)
        .await?;

    let quote = quote_exact_in(
        lb_pair,
        &lb_pair_state,
        amount_in,
        swap_for_y,
        bin_arrays,
        bitmap_extension.as_ref(),
        &clock,
        &mint_x_account,
        &mint_y_account,
    )?;

    println!("{:#?}", quote);

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::SwapWithPriceImpact2 {
        lb_pair,
        bin_array_bitmap_extension: bitmap_extension
            .map(|_| bitmap_extension_key)
            .or(Some(dlmm::ID)),
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_x_program,
        token_y_program,
        user: program.payer(),
        user_token_in,
        user_token_out,
        oracle: lb_pair_state.oracle,
        host_fee_in: Some(dlmm::ID),
        event_authority,
        program: dlmm::ID,
        memo_program: spl_memo::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut remaining_accounts = vec![];

    if let Some((slices, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.rpc(),
            ActionType::Liquidity,
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        remaining_accounts.extend(transfer_hook_remaining_accounts);
    }

    remaining_accounts.extend(
        bin_array_keys
            .into_iter()
            .map(|key| AccountMeta::new(key, false)),
    );

    let data = dlmm::client::args::SwapWithPriceImpact2 {
        amount_in,
        active_id: Some(lb_pair_state.active_id),
        remaining_accounts_info,
        max_price_impact_bps: price_impact_bps,
    }
    .data();

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let swap_ix = Instruction {
        program_id: dlmm::ID,
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
