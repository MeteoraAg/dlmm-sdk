use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{
    solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, solana_sdk::system_program, Program,
};

use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::utils::pda::{derive_event_authority_pda, derive_oracle_pda};

#[derive(Debug)]
pub struct IncreaseLengthParams {
    pub lb_pair: Pubkey,
    pub length_to_add: u64,
}

pub fn increase_length<C: Deref<Target = impl Signer> + Clone>(
    params: IncreaseLengthParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let IncreaseLengthParams {
        lb_pair,
        length_to_add,
    } = params;

    let (oracle, _) = derive_oracle_pda(lb_pair);
    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::IncreaseOracleLength {
        funder: program.payer(),
        oracle,
        system_program: system_program::ID,
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::IncreaseOracleLength { length_to_add };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Increase oracle {oracle} length. Signature: {signature:#?}");

    signature?;

    Ok(())
}
