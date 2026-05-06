use crate::*;

#[derive(Debug, Parser)]
pub struct CloseOperatorAccountParams {
    /// Whitelisted signer pubkey whose operator PDA to close
    #[clap(long)]
    pub whitelisted_signer: Pubkey,
}

pub async fn execute_close_operator_account<C: Deref<Target = impl Signer> + Clone>(
    params: CloseOperatorAccountParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let CloseOperatorAccountParams { whitelisted_signer } = params;

    let (operator, _bump) = derive_operator_pda(whitelisted_signer);

    let accounts = dlmm::client::accounts::CloseOperatorAccount {
        operator,
        signer: program.payer(),
        rent_receiver: program.payer(),
    }
    .to_account_metas(None);

    let data = dlmm::client::args::CloseOperatorAccount {}.data();

    let instruction = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(instruction)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Close operator account. Signature: {signature:#?}");

    signature?;

    Ok(())
}
