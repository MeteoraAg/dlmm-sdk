use crate::*;

pub async fn execute_close_preset_parameter<C: Deref<Target = impl Signer> + Clone>(
    preset_parameter: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let accounts: [AccountMeta; CLOSE_PRESET_PARAMETER_IX_ACCOUNTS_LEN] =
        ClosePresetParameterKeys {
            admin: program.payer(),
            rent_receiver: program.payer(),
            preset_parameter,
        }
        .into();

    let data = ClosePresetParameter2IxData;

    let instruction = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data: data.try_to_vec()?,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(instruction)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Close preset parameter {}. Signature: {signature:#?}",
        preset_parameter
    );

    signature?;

    Ok(preset_parameter)
}
