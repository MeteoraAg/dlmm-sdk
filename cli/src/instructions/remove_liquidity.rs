use crate::*;
use instructions::*;

#[derive(Debug, Parser)]
pub struct RemoveLiquidityParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Bin liquidity information to be remove. "<BIN_ID,BPS_TO_REMOVE, BIN_ID,BPS_TO_REMOVE, ...>" where
    /// BIN_ID = bin id to withdraw
    /// BPS_TO_REMOVE = Percentage of position owned share to be removed. Maximum is 1.0f, which equivalent to 100%.
    #[clap(long, value_parser = parse_bin_liquidity_removal, value_delimiter = ' ', allow_hyphen_values = true)]
    pub bin_liquidity_removal: Vec<(i32, f64)>,
    /// Position to be withdraw.
    pub position: Pubkey,
}

pub async fn execute_remove_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: RemoveLiquidityParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let RemoveLiquidityParams {
        lb_pair,
        position,
        mut bin_liquidity_removal,
    } = params;

    bin_liquidity_removal.sort_by(|a, b| a.0.cmp(&b.0));

    let rpc_client = program.async_rpc();

    let mut accounts = rpc_client
        .get_multiple_accounts(&[lb_pair, position])
        .await?;

    let lb_pair_account = accounts[0].take().context("lb_pair not found")?;
    let position_account = accounts[1].take().context("position not found")?;

    let lb_pair_state = LbPairAccount::deserialize(&lb_pair_account.data)?.0;
    let position_state = PositionV2Account::deserialize(&position_account.data)?.0;

    let min_bin_id = bin_liquidity_removal
        .first()
        .map(|(bin_id, _)| *bin_id)
        .context("bin_liquidity_removal is empty")?;

    let max_bin_id = bin_liquidity_removal
        .last()
        .map(|(bin_id, _)| *bin_id)
        .context("bin_liquidity_removal is empty")?;

    let bin_arrays_account_meta =
        position_state.get_bin_array_accounts_meta_coverage_by_chunk(min_bin_id, max_bin_id)?;

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);
    let bin_array_bitmap_extension = rpc_client
        .get_account(&bin_array_bitmap_extension)
        .await
        .map(|_| bin_array_bitmap_extension)
        .unwrap_or(dlmm_interface::ID);

    let (event_authority, _bump) = derive_event_authority_pda();

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut remaining_accounts = vec![];

    if let Some((slices, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.async_rpc(),
            ActionType::Liquidity,
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        remaining_accounts.extend(transfer_hook_remaining_accounts);
    };

    remaining_accounts.extend(bin_arrays_account_meta);

    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let main_accounts: [AccountMeta; REMOVE_LIQUIDITY2_IX_ACCOUNTS_LEN] = RemoveLiquidity2Keys {
        position,
        lb_pair,
        bin_array_bitmap_extension,
        user_token_x,
        user_token_y,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_x_program,
        token_y_mint: lb_pair_state.token_y_mint,
        token_y_program,
        sender: program.payer(),
        memo_program: spl_memo::ID,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let bin_liquidity_removal = bin_liquidity_removal
        .into_iter()
        .map(|(bin_id, bps)| BinLiquidityReduction {
            bin_id,
            bps_to_remove: (bps * BASIS_POINT_MAX as f64) as u16,
        })
        .collect::<Vec<BinLiquidityReduction>>();

    let data = RemoveLiquidity2IxData(RemoveLiquidity2IxArgs {
        bin_liquidity_removal,
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let remove_liquidity_ix = Instruction {
        program_id: dlmm_interface::ID,
        data,
        accounts,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(remove_liquidity_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Remove Liquidity. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
