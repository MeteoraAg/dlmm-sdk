use crate::*;

#[derive(Debug, Parser)]
pub struct CreateClaimFeeOperatorParams {
    #[clap(long)]
    pub operator: Pubkey,
}

pub async fn execute_create_claim_protocol_fee_operator<C: Deref<Target = impl Signer> + Clone>(
    params: CreateClaimFeeOperatorParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let CreateClaimFeeOperatorParams { operator } = params;

    let (claim_fee_operator, _bump) = derive_claim_protocol_fee_operator_pda(operator);

    let accounts = dlmm::client::accounts::CreateClaimProtocolFeeOperator {
        claim_fee_operator,
        operator,
        admin: program.payer(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::CreateClaimProtocolFeeOperator {}.data();

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

    println!("Create claim protocol fee operator. Signature: {signature:#?}");

    signature?;

    Ok(())
}
