use crate::*;
use instructions::*;

#[derive(Debug, Parser)]
pub struct ClaimFeeParams {
    pub position: Pubkey,
}

pub async fn execute_claim_fee<C: Deref<Target = impl Signer> + Clone>(
    params: ClaimFeeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let ClaimFeeParams { position } = params;

    let rpc_client = program.async_rpc();
    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(DynamicPosition::deserialize(&account.data)?)
        })
        .await?;

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&position_state.global_data.lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

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

    let bin_arrays_account_meta = position_state
        .global_data
        .get_bin_array_accounts_meta_coverage()?;

    let [token_program_x, token_program_y] = lb_pair_state.get_token_programs()?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts: [AccountMeta; CLAIM_FEE2_IX_ACCOUNTS_LEN] = dlmm_interface::ClaimFee2Keys {
        lb_pair: position_state.global_data.lb_pair,
        sender: program.payer(),
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_program_x,
        token_program_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        user_token_x,
        user_token_y,
        event_authority,
        program: dlmm_interface::ID,
        memo_program: spl_memo::id(),
    }
    .into();

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut remaining_accounts = vec![];

    if let Some((slices, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.async_rpc(),
            ActionType::LiquidityProvision,
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        remaining_accounts.extend(transfer_hook_remaining_accounts);
    };

    remaining_accounts.extend(bin_arrays_account_meta);

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let data = ClaimFee2IxData(ClaimFee2IxArgs {
        min_bin_id: position_state.global_data.lower_bin_id,
        max_bin_id: position_state.global_data.upper_bin_id, // TODO: Pass in bin id from args, or dynamically check based on position
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let claim_fee_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(claim_fee_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Claim fee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
