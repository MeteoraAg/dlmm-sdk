use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::signature::Keypair;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::ToAccountMetas;
use anyhow::*;
use dlmm_program_interface::accounts;
use dlmm_program_interface::instruction;
use dlmm_program_interface::utils::pda::derive_event_authority_pda;
use std::ops::Deref;

#[derive(Debug)]
pub struct InitPositionParameters {
    pub lb_pair: Pubkey,
    pub lower_bin_id: i32,
    pub width: i32,
}

pub fn initialize_position<C: Deref<Target = impl Signer> + Clone>(
    params: InitPositionParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPositionParameters {
        lb_pair,
        lower_bin_id,
        width,
    } = params;

    let position_keypair = Keypair::new();

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::InitializePosition {
        lb_pair,
        payer: program.payer(),
        position: position_keypair.pubkey(),
        owner: program.payer(),
        rent: anchor_client::solana_sdk::sysvar::rent::ID,
        system_program: anchor_client::solana_sdk::system_program::ID,
        event_authority,
        program: dlmm_program_interface::ID,
    }
    .to_account_metas(None);

    let ix = instruction::InitializePosition {
        lower_bin_id,
        width,
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .signer(&position_keypair)
        .send_with_spinner_and_config(transaction_config);

    println!(
        "Initialize position {}. Signature: {signature:#?}",
        position_keypair.pubkey()
    );

    signature?;

    Ok(position_keypair.pubkey())
}
