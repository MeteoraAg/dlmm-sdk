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

    let accounts: [AccountMeta; INCREASE_ORACLE_LENGTH_IX_ACCOUNTS_LEN] =
        IncreaseOracleLengthKeys {
            funder: program.payer(),
            oracle,
            system_program: solana_sdk::system_program::ID,
            event_authority,
            program: dlmm_interface::ID,
        }
        .into();

    let data =
        IncreaseOracleLengthIxData(IncreaseOracleLengthIxArgs { length_to_add }).try_to_vec()?;

    let increase_length_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
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
