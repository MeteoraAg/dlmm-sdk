use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;

#[derive(Debug)]
pub struct SetActivationPointParam {
    pub lb_pair: Pubkey,
    pub activation_point: u64,
}

pub async fn set_activation_point<C: Deref<Target = impl Signer> + Clone>(
    params: SetActivationPointParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetActivationPointParam {
        lb_pair,
        activation_point,
    } = params;

    let accounts = lb_clmm::accounts::SetActivationPoint {
        admin: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let ix_data = lb_clmm::instruction::SetActivationPoint { activation_point }.data();

    let set_activation_point_ix = Instruction {
        accounts,
        data: ix_data,
        program_id: lb_clmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(set_activation_point_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set activation point. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
