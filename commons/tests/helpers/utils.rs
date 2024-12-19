use anchor_lang::solana_program::{instruction::Instruction, pubkey::Pubkey};
use anchor_lang::AccountDeserialize;
use anchor_spl::associated_token::*;
use anchor_spl::token::spl_token;
use assert_matches::assert_matches;
use async_trait::async_trait;
use solana_program_test::BanksClient;
use solana_sdk::{
    signature::{Keypair, Signer},
    transaction::Transaction,
};
pub async fn process_and_assert_ok(
    instructions: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
    banks_client: &mut BanksClient,
) {
    let recent_blockhash = banks_client.get_latest_blockhash().await.unwrap();

    let mut all_signers = vec![payer];
    all_signers.extend_from_slice(signers);

    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&payer.pubkey()),
        &all_signers,
        recent_blockhash,
    );

    assert_matches!(banks_client.process_transaction(tx).await, Ok(()));
}

#[async_trait]
pub trait AnchorAdapter {
    async fn get_account_with_anchor_seder<T: AccountDeserialize>(
        &mut self,
        address: Pubkey,
    ) -> Option<T>;
}
#[async_trait]
impl AnchorAdapter for BanksClient {
    async fn get_account_with_anchor_seder<T: AccountDeserialize>(
        &mut self,
        address: Pubkey,
    ) -> Option<T> {
        let account = self.get_account(address).await.unwrap()?;
        T::try_deserialize(&mut account.data.as_ref()).ok()
    }
}

pub async fn get_or_create_ata(
    payer: &Keypair,
    token_mint: &Pubkey,
    authority: &Pubkey,
    banks_client: &mut BanksClient,
) -> Pubkey {
    let ata_address = get_associated_token_address(authority, token_mint);
    let ata_account = banks_client.get_account(ata_address).await.unwrap();
    if let None = ata_account {
        create_associated_token_account(payer, token_mint, authority, banks_client).await;
    }
    ata_address
}

pub async fn create_associated_token_account(
    payer: &Keypair,
    token_mint: &Pubkey,
    authority: &Pubkey,
    banks_client: &mut BanksClient,
) {
    let ins = vec![
        spl_associated_token_account::instruction::create_associated_token_account(
            &payer.pubkey(),
            &authority,
            &token_mint,
            &spl_token::id(),
        ),
    ];

    process_and_assert_ok(&ins, payer, &[payer], banks_client).await;
}

pub async fn warp_sol(
    payer: &Keypair,
    wallet: Pubkey,
    amount: u64,
    banks_client: &mut BanksClient,
) {
    let wsol_ata = spl_associated_token_account::get_associated_token_address(
        &wallet,
        &spl_token::native_mint::id(),
    );

    let create_wsol_ata_ix =
        spl_associated_token_account::instruction::create_associated_token_account(
            &payer.pubkey(),
            &payer.pubkey(),
            &spl_token::native_mint::id(),
            &spl_token::id(),
        );

    let transfer_sol_ix =
        solana_program::system_instruction::transfer(&payer.pubkey(), &wsol_ata, amount);

    let sync_native_ix = spl_token::instruction::sync_native(&spl_token::id(), &wsol_ata).unwrap();

    process_and_assert_ok(
        &[create_wsol_ata_ix, transfer_sol_ix, sync_native_ix],
        &payer,
        &[&payer],
        banks_client,
    )
    .await;
}

pub async fn get_clock(banks_client: &mut BanksClient) -> solana_program::clock::Clock {
    let clock_account = banks_client
        .get_account(solana_program::sysvar::clock::id())
        .await
        .unwrap()
        .unwrap();

    let clock_state =
        bincode::deserialize::<solana_program::clock::Clock>(clock_account.data.as_ref()).unwrap();

    clock_state
}
