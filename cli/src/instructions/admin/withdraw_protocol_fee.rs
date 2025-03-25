use anchor_spl::associated_token::get_associated_token_address_with_program_id;

use crate::*;
#[derive(Debug, Parser)]
pub struct WithdrawProtocolFeeParams {
    pub lb_pair: Pubkey,
    pub amount_x: u64,
    pub amount_y: u64,
}

pub async fn execute_withdraw_protocol_fee<C: Deref<Target = impl Signer> + Clone>(
    params: WithdrawProtocolFeeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let WithdrawProtocolFeeParams {
        lb_pair,
        amount_x,
        amount_y,
    } = params;

    let rpc_client = program.async_rpc();

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let receiver_token_x = get_associated_token_address_with_program_id(
        &program.payer(),
        &lb_pair_state.token_x_mint,
        &token_x_program,
    );

    let receiver_token_y = get_associated_token_address_with_program_id(
        &program.payer(),
        &lb_pair_state.token_y_mint,
        &token_y_program,
    );

    let (claim_fee_operator, _) = derive_claim_protocol_fee_operator_pda(program.payer());

    let main_accounts: [AccountMeta; WITHDRAW_PROTOCOL_FEE_IX_ACCOUNTS_LEN] =
        WithdrawProtocolFeeKeys {
            lb_pair,
            reserve_x: lb_pair_state.reserve_x,
            reserve_y: lb_pair_state.reserve_y,
            token_x_mint: lb_pair_state.token_x_mint,
            token_y_mint: lb_pair_state.token_y_mint,
            token_x_program,
            token_y_program,
            receiver_token_x,
            receiver_token_y,
            claim_fee_operator,
            operator: program.payer(),
            memo_program: spl_memo::ID,
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

    let data = WithdrawProtocolFeeIxData(WithdrawProtocolFeeIxArgs {
        amount_x,
        amount_y,
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let withdraw_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(200_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(withdraw_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("WithdrawProtocolFee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
