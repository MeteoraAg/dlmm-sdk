use crate::*;
use instructions::*;

#[derive(Debug, Parser)]
pub struct AddLiquidityParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Position for the deposit.
    pub position: Pubkey,
    /// Amount of token X to be deposited.
    pub amount_x: u64,
    /// Amount of token Y to be deposited.
    pub amount_y: u64,
    /// Liquidity distribution to the bins. "<DELTA_ID,DIST_X,DIST_Y, DELTA_ID,DIST_X,DIST_Y, ...>" where
    /// DELTA_ID = Number of bins surrounding the active bin. This decide which bin the token is going to deposit to. For example: if the current active id is 5555, delta_ids is 1, the user will be depositing to bin 5554, 5555, and 5556.
    /// DIST_X = Percentage of amount_x to be deposited to the bins. Must not > 1.0
    /// DIST_Y = Percentage of amount_y to be deposited to the bins. Must not > 1.0
    /// For example: --bin-liquidity-distribution "-1,0.0,0.25 0,0.75,0.75 1,0.25,0.0"
    #[clap(long, value_parser = parse_bin_liquidity_distribution, value_delimiter = ' ', allow_hyphen_values = true)]
    pub bin_liquidity_distribution: Vec<(i32, f64, f64)>,
}

pub async fn execute_add_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: AddLiquidityParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let AddLiquidityParams {
        lb_pair,
        position,
        amount_x,
        amount_y,
        mut bin_liquidity_distribution,
    } = params;

    // Sort by bin id
    bin_liquidity_distribution.sort_by(|a, b| a.0.cmp(&b.0));

    let rpc_client = program.async_rpc();

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let bin_liquidity_distribution = bin_liquidity_distribution
        .into_iter()
        .map(|(bin_id, dist_x, dist_y)| BinLiquidityDistribution {
            bin_id,
            distribution_x: (dist_x * BASIS_POINT_MAX as f64) as u16,
            distribution_y: (dist_y * BASIS_POINT_MAX as f64) as u16,
        })
        .collect::<Vec<_>>();

    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(PositionV2Account::deserialize(&account.data)?.0)
        })
        .await?;

    let min_bin_id = bin_liquidity_distribution
        .first()
        .map(|bld| bld.bin_id)
        .context("No bin liquidity distribution provided")?;

    let max_bin_id = bin_liquidity_distribution
        .last()
        .map(|bld| bld.bin_id)
        .context("No bin liquidity distribution provided")?;

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

    let main_accounts: [AccountMeta; ADD_LIQUIDITY2_IX_ACCOUNTS_LEN] = AddLiquidity2Keys {
        lb_pair,
        bin_array_bitmap_extension,
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        sender: program.payer(),
        user_token_x,
        user_token_y,
        token_x_program,
        token_y_program,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

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

    let data = AddLiquidity2IxData(AddLiquidity2IxArgs {
        liquidity_parameter: LiquidityParameter {
            amount_x,
            amount_y,
            bin_liquidity_dist: bin_liquidity_distribution,
        },
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let add_liquidity_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(add_liquidity_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Add Liquidity. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
