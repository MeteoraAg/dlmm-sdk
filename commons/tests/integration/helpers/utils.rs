use anchor_lang::AccountDeserialize;
use anchor_spl::associated_token::*;
use anchor_spl::token::spl_token;
use anchor_spl::token_interface::TokenAccount;
use assert_matches::assert_matches;
use commons::dlmm::accounts::{BinArray, LbPair};
use solana_program::clock::Clock;
use solana_program_test::BanksClient;
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use std::collections::HashMap;
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
        instructions,
        Some(&payer.pubkey()),
        &all_signers,
        recent_blockhash,
    );

    let result = banks_client.process_transaction(tx).await.inspect_err(|e| {
        println!("Transaction error: {}", e);
    });

    assert_matches!(result, Ok(()));
}

pub async fn get_or_create_ata(
    payer: &Keypair,
    token_mint: &Pubkey,
    authority: &Pubkey,
    banks_client: &mut BanksClient,
) -> Pubkey {
    let token_mint_owner = banks_client
        .get_account(*token_mint)
        .await
        .ok()
        .flatten()
        .unwrap()
        .owner;
    let ata_address =
        get_associated_token_address_with_program_id(authority, token_mint, &token_mint_owner);
    let ata_account = banks_client.get_account(ata_address).await.unwrap();
    if ata_account.is_none() {
        create_associated_token_account(
            payer,
            token_mint,
            authority,
            &token_mint_owner,
            banks_client,
        )
        .await;
    }
    ata_address
}

pub async fn create_associated_token_account(
    payer: &Keypair,
    token_mint: &Pubkey,
    authority: &Pubkey,
    program_id: &Pubkey,
    banks_client: &mut BanksClient,
) {
    println!("{}", program_id);
    let ins = vec![
        spl_associated_token_account::instruction::create_associated_token_account(
            &payer.pubkey(),
            authority,
            token_mint,
            program_id,
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

pub async fn mint_spl_tokens(
    payer: &Keypair,
    mint: &Pubkey,
    destination: &Pubkey,
    mint_authority: &Keypair,
    amount: u64,
    banks_client: &mut BanksClient,
) {
    let ix = spl_token::instruction::mint_to(
        &spl_token::id(),
        mint,
        destination,
        &mint_authority.pubkey(),
        &[],
        amount,
    )
    .unwrap();

    process_and_assert_ok(&[ix], payer, &[payer, mint_authority], banks_client).await;
}

pub async fn get_clock(banks_client: &mut BanksClient) -> Clock {
    let clock_account = banks_client
        .get_account(solana_program::sysvar::clock::id())
        .await
        .unwrap()
        .unwrap();

    let clock_state = bincode::deserialize::<Clock>(clock_account.data.as_ref()).unwrap();

    clock_state
}

pub async fn fetch_account(banks_client: &mut BanksClient, pubkey: Pubkey) -> Account {
    banks_client
        .get_account(pubkey)
        .await
        .ok()
        .flatten()
        .unwrap()
}

pub async fn fetch_token_account_state(
    banks_client: &mut BanksClient,
    pubkey: Pubkey,
) -> TokenAccount {
    let account = fetch_account(banks_client, pubkey).await;
    TokenAccount::try_deserialize(&mut account.data.as_ref()).unwrap()
}

pub async fn fetch_lb_pair(banks_client: &mut BanksClient, pubkey: Pubkey) -> LbPair {
    let account = fetch_account(banks_client, pubkey).await;
    bytemuck::pod_read_unaligned(&account.data[8..])
}

pub async fn fetch_swap_state(
    banks_client: &mut BanksClient,
    lb_pair_pubkey: Pubkey,
    bin_array_pubkeys: &[Pubkey],
) -> (LbPair, HashMap<Pubkey, BinArray>, Account, Account, Clock) {
    let lb_pair_state = fetch_lb_pair(banks_client, lb_pair_pubkey).await;

    let mut bin_arrays = HashMap::new();
    for &pubkey in bin_array_pubkeys {
        let account = fetch_account(banks_client, pubkey).await;
        let state: BinArray = bytemuck::pod_read_unaligned(&account.data[8..]);
        bin_arrays.insert(pubkey, state);
    }

    let mint_x_account = fetch_account(banks_client, lb_pair_state.token_x_mint).await;
    let mint_y_account = fetch_account(banks_client, lb_pair_state.token_y_mint).await;
    let clock = get_clock(banks_client).await;

    (
        lb_pair_state,
        bin_arrays,
        mint_x_account,
        mint_y_account,
        clock,
    )
}
