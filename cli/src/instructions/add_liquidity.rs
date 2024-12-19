use crate::*;
use instructions::*;

#[derive(Debug)]
pub struct AddLiquidityParam {
    pub lb_pair: Pubkey,
    pub position: Pubkey,
    pub amount_x: u64,
    pub amount_y: u64,
    pub bin_liquidity_distribution: Vec<(i32, f64, f64)>,
}

pub async fn execute_add_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: AddLiquidityParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let AddLiquidityParam {
        lb_pair,
        position,
        amount_x,
        amount_y,
        bin_liquidity_distribution,
    } = params;

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
            Ok(DynamicPosition::deserialize(&account.data)?)
        })
        .await?;

    let bin_arrays_account_meta = position_state
        .global_data
        .get_bin_array_accounts_meta_coverage()?;

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
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
        memo_program: spl_memo::ID,
    }
    .into();

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

    let data = AddLiquidity2IxData(AddLiquidity2IxArgs {
        liquidity_parameter: LiquidityParameter {
            amount_x,
            amount_y,
            bin_liquidity_dist: bin_liquidity_distribution,
        },
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let remaining_account = [
        transfer_hook_x_accounts,
        transfer_hook_y_accounts,
        bin_arrays_account_meta,
    ]
    .concat();

    let accounts = [main_accounts.to_vec(), remaining_account].concat();

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
