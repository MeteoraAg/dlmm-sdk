use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;

#[derive(Debug)]
pub struct SetPreactivationSlotParam {
    pub lb_pair: Pubkey,
    pub pre_activation_slot_duration: u16,
}

pub async fn set_pre_activation_slot_duration<C: Deref<Target = impl Signer> + Clone>(
    params: SetPreactivationSlotParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPreactivationSlotParam {
        lb_pair,
        pre_activation_slot_duration,
    } = params;

    let accounts = lb_clmm::accounts::SetPreActivationInfo {
        creator: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let ix_data = lb_clmm::instruction::SetPreActivationSlotDuration {
        pre_activation_slot_duration,
    }
    .data();

    let set_pre_activation_slot_duration_ix = Instruction {
        accounts,
        data: ix_data,
        program_id: lb_clmm::ID,
    };

    let request_builder = program.request();

    let signature = request_builder
        .instruction(set_pre_activation_slot_duration_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Set pre activation slot duration. Signature: {:#?}",
        signature
    );

    signature?;

    Ok(())
}
