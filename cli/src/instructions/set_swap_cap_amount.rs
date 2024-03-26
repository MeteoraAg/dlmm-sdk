use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{InstructionData, ToAccountMetas};
use anyhow::*;
use std::ops::Deref;

#[derive(Debug)]
pub struct SetSwapCapParam {
    pub lb_pair: Pubkey,
    pub swap_cap_deactivate_slot: u64,
    pub swap_cap_amount: u64,
}

pub async fn set_swap_cap<C: Deref<Target = impl Signer> + Clone>(
    params: SetSwapCapParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetSwapCapParam {
        lb_pair,
        swap_cap_amount,
        swap_cap_deactivate_slot,
    } = params;

    let accounts = lb_clmm::accounts::SetMaxSwappedAmount {
        admin: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let ix_data = lb_clmm::instruction::SetMaxSwappedAmount {
        max_swapped_amount: swap_cap_amount,
        swap_cap_deactivate_slot,
    }
    .data();

    let set_swap_cap_ix = Instruction {
        accounts,
        data: ix_data,
        program_id: lb_clmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(set_swap_cap_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set swap cap. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
