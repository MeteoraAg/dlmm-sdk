use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;

#[derive(Debug)]
pub struct SetPairStatusParam {
    pub lb_pair: Pubkey,
    pub pair_status: u8,
}

pub async fn set_pair_status<C: Deref<Target = impl Signer> + Clone>(
    params: SetPairStatusParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPairStatusParam {
        lb_pair,
        pair_status,
    } = params;

    let accounts = lb_clmm::accounts::SetPairStatus {
        admin: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let ix_data = lb_clmm::instruction::SetPairStatus {
        status: pair_status,
    }
    .data();

    let set_pair_status_ix = Instruction {
        accounts,
        data: ix_data,
        program_id: lb_clmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(set_pair_status_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set pair status successfully. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
