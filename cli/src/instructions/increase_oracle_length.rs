use crate::*;
use anchor_client::solana_sdk;

#[derive(Debug, Parser)]
pub struct IncreaseOracleLengthParams {
    pub lb_pair: Pubkey,
    pub length_to_add: u64,
}

pub async fn execute_increase_oracle_length<C: Deref<Target = impl Signer> + Clone>(
    params: IncreaseOracleLengthParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let IncreaseOracleLengthParams {
        lb_pair,
        length_to_add,
    } = params;

    let (oracle, _) = derive_oracle_pda(lb_pair);
    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = dlmm::client::accounts::IncreaseOracleLength {
        funder: program.payer(),
        oracle,
        system_program: solana_sdk::system_program::ID,
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::IncreaseOracleLength { length_to_add }.data();

    let increase_length_ix = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(increase_length_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Increase oracle {oracle} length. Signature: {signature:#?}");

    signature?;

    Ok(())
}
