use crate::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use commitment_config::CommitmentConfig;
use dlmm_interface::events::SwapEvent;
use solana_client::rpc_response::{Response, RpcSimulateTransactionResult};
use solana_sdk::instruction::Instruction;
use solana_transaction_status::option_serializer::OptionSerializer;
use solana_transaction_status::{UiInstruction, UiTransactionEncoding};
use spl_associated_token_account::instruction::create_associated_token_account;
use std::time::*;
use transaction::Transaction;

pub fn get_epoch_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

pub async fn get_or_create_ata(
    rpc_client: &RpcClient,
    token_mint: Pubkey,
    program_id: Pubkey,
    wallet_address: Pubkey,
    payer: &Keypair,
) -> Result<Pubkey> {
    let user_ata =
        get_associated_token_address_with_program_id(&wallet_address, &token_mint, &program_id);

    let user_ata_exists = rpc_client.get_account(&user_ata).await.is_ok();

    if !user_ata_exists {
        let create_ata_ix = create_associated_token_account(
            &payer.pubkey(),
            &wallet_address,
            &token_mint,
            &program_id,
        );

        let signature = send_tx(&[create_ata_ix], rpc_client, &[], payer).await?;
        println!("Create ata {token_mint} {wallet_address} {signature}");
    }

    Ok(user_ata)
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

pub async fn send_tx(
    instructions: &[Instruction],
    rpc_client: &RpcClient,
    keypairs: &[&Keypair],
    payer: &Keypair,
) -> Result<Signature> {
    let latest_blockhash = rpc_client.get_latest_blockhash().await?;

    let mut tx = Transaction::new_signed_with_payer(
        instructions,
        Some(&payer.pubkey()),
        keypairs,
        latest_blockhash,
    );
    tx.sign(&[payer], latest_blockhash);

    let signature = rpc_client.send_and_confirm_transaction(&tx).await?;

    Ok(signature)
}

pub async fn simulate_transaction(
    instructions: &[Instruction],
    rpc_client: &RpcClient,
    keypairs: &[&Keypair],
    payer: Pubkey,
) -> Result<Response<RpcSimulateTransactionResult>> {
    let latest_blockhash = rpc_client.get_latest_blockhash().await?;

    let tx =
        Transaction::new_signed_with_payer(&instructions, Some(&payer), keypairs, latest_blockhash);
    let simulation = rpc_client.simulate_transaction(&tx).await?;

    Ok(simulation)
}

pub async fn parse_swap_event(rpc_client: &RpcClient, signature: Signature) -> Result<SwapEvent> {
    let tx = rpc_client
        .get_transaction_with_config(
            &signature,
            RpcTransactionConfig {
                encoding: Some(UiTransactionEncoding::Base64),
                commitment: Some(CommitmentConfig::finalized()),
                max_supported_transaction_version: Some(0),
            },
        )
        .await?;

    if let Some(meta) = &tx.transaction.meta {
        if let OptionSerializer::Some(inner_instructions) = meta.inner_instructions.as_ref() {
            let inner_ixs = inner_instructions
                .iter()
                .flat_map(|ix| ix.instructions.as_slice());

            for ix in inner_ixs {
                match ix {
                    UiInstruction::Compiled(compiled_ix) => {
                        if let std::result::Result::Ok(ix_data) =
                            bs58::decode(compiled_ix.data.as_str()).into_vec()
                        {
                            return Ok(SwapEvent::deserialize(&mut ix_data.as_ref())?);
                        };
                    }
                    _ => {}
                }
            }
        }
    }
    Err(Error::msg("Cannot find swap event"))
}
