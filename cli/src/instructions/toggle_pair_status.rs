use crate::*;

pub async fn execute_toggle_pool_status<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let accounts: [AccountMeta; TOGGLE_PAIR_STATUS_IX_ACCOUNTS_LEN] = TogglePairStatusKeys {
        admin: program.payer(),
        lb_pair,
    }
    .into();

    let data = TogglePairStatusIxData.try_to_vec()?;
    let instruction = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(instruction)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Toggle pool status. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
