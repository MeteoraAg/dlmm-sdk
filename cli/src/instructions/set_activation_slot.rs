use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;

#[derive(Debug)]
pub struct SetActivationSlotParam {
    pub lb_pair: Pubkey,
    pub activation_slot: u64,
}

pub async fn set_activation_slot<C: Deref<Target = impl Signer> + Clone>(
    params: SetActivationSlotParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetActivationSlotParam {
        lb_pair,
        activation_slot,
    } = params;

    let accounts = lb_clmm::accounts::SetActivationSlot {
        admin: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let ix_data = lb_clmm::instruction::SetActivationSlot { activation_slot }.data();

    let set_activation_slot_ix = Instruction {
        accounts,
        data: ix_data,
        program_id: lb_clmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(set_activation_slot_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set activation slot. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
