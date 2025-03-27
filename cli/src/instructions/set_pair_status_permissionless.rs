use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;

#[derive(Debug)]
pub struct SetPairStatusPermissionlessParam {
    pub lb_pair: Pubkey,
    pub enable: bool,
}

pub async fn set_pair_status_permissionless<C: Deref<Target = impl Signer> + Clone>(
    params: SetPairStatusPermissionlessParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPairStatusPermissionlessParam { lb_pair, enable } = params;

    let accounts = lb_clmm::accounts::UpdatePairStatusPermissionless {
        creator: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let ix_data = lb_clmm::instruction::SetPairStatusPermissionless {
        status: enable.into(),
    }
    .data();

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

    println!(
        "Set pair status permissionless. Signature: {:#?}",
        signature
    );

    signature?;

    Ok(())
}
