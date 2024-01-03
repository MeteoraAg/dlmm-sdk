use crate::read_keypair_file;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_client::rpc_response::Response;
use anchor_client::solana_client::rpc_response::RpcSimulateTransactionResult;
use anchor_client::solana_client::{
    rpc_client::GetConfirmedSignaturesForAddress2Config, rpc_config::RpcTransactionConfig,
};
use anchor_client::solana_sdk::commitment_config::CommitmentConfig;
use anchor_client::solana_sdk::signature::Signature;
use anchor_client::solana_sdk::signer::keypair::Keypair;
use anchor_client::solana_sdk::transaction::Transaction;
use anchor_client::RequestBuilder;
use anchor_client::{
    solana_sdk::{pubkey::Pubkey, signer::Signer},
    Client, Cluster, Program,
};
use anchor_lang::event::EVENT_IX_TAG_LE;
use anchor_lang::{AnchorDeserialize, AnchorSerialize, Discriminator};
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use anyhow::*;
use lb_clmm::events::{self, Swap as SwapEvent};
use solana_transaction_status::option_serializer::OptionSerializer;
use solana_transaction_status::{
    EncodedConfirmedTransactionWithStatusMeta, UiInstruction, UiTransactionEncoding,
};
use spl_associated_token_account::instruction::create_associated_token_account;
use std::ops::Deref;
use std::result::Result::Ok;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Create an anchor program instance
pub fn create_program<C: Clone + std::ops::Deref<Target = impl Signer>>(
    http_provider: String,
    wss_provider: String,
    program_id: Pubkey,
    payer: C,
) -> Result<Program<C>> {
    let cluster = Cluster::Custom(http_provider, wss_provider);
    let client = Client::new(cluster, payer);
    let program = client.program(program_id)?;

    Ok(program)
}

pub fn get_epoch_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

pub async fn get_or_create_ata<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    token_mint: Pubkey,
    wallet_address: Pubkey,
    payer: &Keypair,
) -> Result<Pubkey> {
    let user_ata = get_associated_token_address(&wallet_address, &token_mint);

    let rpc_client = program.rpc();
    let user_ata_exists = rpc_client.get_account(&user_ata).is_ok();

    match user_ata_exists {
        true => Ok(user_ata),
        false => {
            let builder = program
                .request()
                .instruction(create_associated_token_account(
                    &payer.pubkey(),
                    &wallet_address,
                    &token_mint,
                    &spl_token::ID,
                ));

            let signature = send_tx(vec![payer], payer.pubkey(), program, &builder)?;
            println!("create ata {token_mint} {wallet_address} {signature}");
            Ok(user_ata)
        }
    }
}

pub fn get_transaction_config() -> RpcSendTransactionConfig {
    let commitment_config = CommitmentConfig::confirmed();
    RpcSendTransactionConfig {
        skip_preflight: false,
        preflight_commitment: Some(commitment_config.commitment),
        encoding: None,
        max_retries: None,
        min_context_slot: None,
    }
}

pub fn send_tx<C: Clone + std::ops::Deref<Target = impl Signer>>(
    keypairs: Vec<&Keypair>,
    payer: Pubkey,
    program: &Program<C>,
    builder: &RequestBuilder<C>,
) -> Result<Signature> {
    let rpc_client = program.rpc();
    let latest_blockhash = rpc_client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &builder.instructions()?,
        Some(&payer),
        &keypairs,
        latest_blockhash,
    );

    let signature = rpc_client.send_and_confirm_transaction(&tx)?;
    Ok(signature)
}

pub fn simulate_transaction<C: Clone + std::ops::Deref<Target = impl Signer>>(
    keypairs: Vec<&Keypair>,
    payer: Pubkey,
    program: &Program<C>,
    builder: &RequestBuilder<C>,
) -> Result<Response<RpcSimulateTransactionResult>> {
    let instructions = builder.instructions()?;
    let rpc_client = program.rpc();
    let recent_blockhash = rpc_client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&payer),
        &keypairs,
        recent_blockhash,
    );

    let simulation = rpc_client.simulate_transaction(&tx)?;
    Ok(simulation)
}

pub fn parse_swap_event<C: Clone + std::ops::Deref<Target = impl Signer>>(
    program: &Program<C>,
    signature: Signature,
) -> Result<SwapEvent> {
    let tx = program.rpc().get_transaction_with_config(
        &signature,
        RpcTransactionConfig {
            encoding: Some(UiTransactionEncoding::Base64),
            commitment: Some(CommitmentConfig::finalized()),
            max_supported_transaction_version: Some(0),
        },
    )?;

    if let Some(meta) = &tx.transaction.meta {
        if let OptionSerializer::Some(inner_instructions) = meta.inner_instructions.as_ref() {
            let inner_ixs = inner_instructions
                .iter()
                .flat_map(|ix| ix.instructions.as_slice());

            for ix in inner_ixs {
                match ix {
                    UiInstruction::Compiled(compiled_ix) => {
                        if let Ok(ix_data) = bs58::decode(compiled_ix.data.as_str()).into_vec() {
                            match parse_event_cpi::<SwapEvent>(&ix_data) {
                                Some(event) => return Ok(event),
                                None => {}
                            }
                        };
                    }
                    _ => {}
                }
            }
        }
    }
    Err(Error::msg("Cannot find swap event"))
}

pub fn parse_event_cpi<T: AnchorDeserialize + AnchorSerialize + Discriminator>(
    ix_data: &[u8],
) -> Option<T> {
    if &ix_data[..8] == EVENT_IX_TAG_LE {
        let event_cpi = &ix_data[8..];
        let event_discriminator = &event_cpi[..8];
        if event_discriminator.eq(&T::discriminator()) {
            let event = T::try_from_slice(&event_cpi[8..]);
            return event.ok();
        }
    }

    None
}
