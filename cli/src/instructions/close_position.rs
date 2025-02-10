use crate::*;

#[derive(Debug, Parser)]
pub struct ClosePositionParams {
    pub position: Pubkey,
}

pub async fn execute_close_position<C: Deref<Target = impl Signer> + Clone>(
    params: ClosePositionParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let ClosePositionParams { position } = params;

    let rpc_client = program.async_rpc();
    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(PositionV2Account::deserialize(&account.data)?.0)
        })
        .await?;

    let bin_arrays_account_meta = position_state.get_bin_array_accounts_meta_coverage()?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts: [AccountMeta; CLOSE_POSITION2_IX_ACCOUNTS_LEN] = ClosePosition2Keys {
        sender: position_state.owner,
        rent_receiver: position_state.owner,
        position,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let data = ClosePosition2IxData.try_to_vec()?;
    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let accounts = [main_accounts.to_vec(), bin_arrays_account_meta].concat();

    let close_position_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(close_position_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Close position. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
