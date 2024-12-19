#![cfg(feature = "test-bpf")]
mod helpers;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, pubkey::Pubkey};
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::token::{spl_token, TokenAccount};
use helpers::*;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::derive_event_authority_pda;
use solana_program_test::*;
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::signature::Signer;
use std::collections::HashMap;
use std::str::FromStr;
use std::{assert_eq, println};
use utils::*;

#[tokio::test]
async fn test_swap() {
    let mut test = ProgramTest::default();

    test.add_program("./tests/artifacts/lb_clmm_prod", lb_clmm::id(), None);

    let lb_pair = Pubkey::from_str("EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig").unwrap();
    let reserve_x = Pubkey::from_str("BmW4cCRpJwwL8maFB1AoAuEQf96t64Eq5gUvXikZardM").unwrap();
    let reserve_y = Pubkey::from_str("FDZDrPtCjmSHeq14goCxp5pCJSRekSXY3XSgGz5Rvass").unwrap();
    let token_x_mint = Pubkey::from_str("Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump").unwrap();
    let token_y_mint = anchor_spl::token::spl_token::native_mint::id();
    let oracle = Pubkey::from_str("Fnkg415DEx72GSPooKUWTbPS9wzKucQe4qnvFrrvcZK2").unwrap();
    let bin_array_1 = Pubkey::from_str("5Sm2ecMeqohRkNpFJPWSqHL1BkA7AEW4ck8TmdF1gD4t").unwrap();
    let bin_array_2 = Pubkey::from_str("E6gur9Jw8675DCR7GpJVhoSrkruRgt8EdEVqLAc5RLUt").unwrap();

    test.add_account_with_file_data(
        lb_pair,
        10 * LAMPORTS_PER_SOL,
        lb_clmm::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/lb_pair.bin",
    );

    test.add_account_with_file_data(
        oracle,
        10 * LAMPORTS_PER_SOL,
        lb_clmm::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/oracle.bin",
    );

    test.add_account_with_file_data(
        bin_array_1,
        10 * LAMPORTS_PER_SOL,
        lb_clmm::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/bin_array_1.bin",
    );

    test.add_account_with_file_data(
        bin_array_2,
        10 * LAMPORTS_PER_SOL,
        lb_clmm::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/bin_array_2.bin",
    );

    test.add_account_with_file_data(
        token_x_mint,
        10 * LAMPORTS_PER_SOL,
        spl_token::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/token_x_mint.bin",
    );

    test.add_account_with_file_data(
        reserve_x,
        10 * LAMPORTS_PER_SOL,
        spl_token::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/reserve_x.bin",
    );

    test.add_account_with_file_data(
        reserve_y,
        10 * LAMPORTS_PER_SOL,
        spl_token::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/reserve_y.bin",
    );

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    let amount_in = 100_000;

    warp_sol(&payer, payer.pubkey(), amount_in, &mut banks_client).await;

    let user_token_in =
        get_or_create_ata(&payer, &token_y_mint, &payer.pubkey(), &mut banks_client).await;

    let user_token_out =
        get_or_create_ata(&payer, &token_x_mint, &payer.pubkey(), &mut banks_client).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let lb_pair_state: LbPair = banks_client
        .get_account_with_anchor_seder(lb_pair)
        .await
        .unwrap();

    let bin_array_1_state: BinArray = banks_client
        .get_account_with_anchor_seder(bin_array_1)
        .await
        .unwrap();

    let bin_array_2_state: BinArray = banks_client
        .get_account_with_anchor_seder(bin_array_2)
        .await
        .unwrap();

    let mut bin_arrays = HashMap::new();
    bin_arrays.insert(bin_array_1, bin_array_1_state);
    bin_arrays.insert(bin_array_2, bin_array_2_state);

    let clock = get_clock(&mut banks_client).await;

    let quote_result = commons::quote::quote_exact_in(
        lb_pair,
        &lb_pair_state,
        amount_in,
        false,
        bin_arrays,
        None,
        clock.unix_timestamp as u64,
        clock.slot,
    )
    .unwrap();

    println!("quote_result {:?}", quote_result);

    let user_token_out_state_before: TokenAccount = banks_client
        .get_account_with_anchor_seder(user_token_out)
        .await
        .unwrap();

    let mut accounts = lb_clmm::accounts::Swap {
        lb_pair,
        oracle,
        bin_array_bitmap_extension: None,
        reserve_x,
        reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint,
        token_y_mint,
        host_fee_in: None,
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: lb_clmm::id(),
        event_authority,
    }
    .to_account_metas(None);
    let mut remaining_accounts = vec![
        AccountMeta::new(bin_array_1, false),
        AccountMeta::new(bin_array_2, false),
    ];
    accounts.append(&mut remaining_accounts);

    let swap_ix = Instruction {
        program_id: lb_clmm::id(),
        accounts,
        data: lb_clmm::instruction::Swap {
            amount_in,
            min_amount_out: 0,
        }
        .data(),
    };

    process_and_assert_ok(&[swap_ix], &payer, &[&payer], &mut banks_client).await;

    let user_token_out_state_after: TokenAccount = banks_client
        .get_account_with_anchor_seder(user_token_out)
        .await
        .unwrap();

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        quote_result.amount_out
    );
}
