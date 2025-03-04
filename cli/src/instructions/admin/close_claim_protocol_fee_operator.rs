use crate::*;

#[derive(Debug, Parser)]
pub struct CloseClaimFeeOperatorParams {
    #[clap(long)]
    pub operator: Pubkey,
}

pub async fn execute_close_claim_protocol_fee_operator<C: Deref<Target = impl Signer> + Clone>(
    params: CloseClaimFeeOperatorParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let CloseClaimFeeOperatorParams { operator } = params;

    let (claim_fee_operator, _bump) = derive_claim_protocol_fee_operator_pda(operator);

    let accounts: [AccountMeta; CLOSE_CLAIM_PROTOCOL_FEE_OPERATOR_IX_ACCOUNTS_LEN] =
        CloseClaimProtocolFeeOperatorKeys {
            claim_fee_operator,
            admin: program.payer(),
            rent_receiver: program.payer(),
        }
        .into();

    let data = CloseClaimProtocolFeeOperatorIxData;

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

    println!("Close claim protocol fee operator. Signature: {signature:#?}");

    signature?;

    Ok(())
}
