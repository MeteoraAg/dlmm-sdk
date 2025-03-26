mod helpers;
use anchor_client::anchor_lang::AccountDeserialize;
use anchor_spl::token::{spl_token, TokenAccount};
use commons::derive_event_authority_pda;
use dlmm_interface::{
    BinArrayAccount, LbPairAccount, RemainingAccountsInfo, Swap2IxArgs, SwapExactOut2IxArgs,
    SWAP2_IX_ACCOUNTS_LEN,
};
use helpers::*;
use solana_program_test::*;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::native_token::LAMPORTS_PER_SOL;
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Signer;
use std::collections::HashMap;
use std::str::FromStr;
use std::{assert_eq, println};
use utils::*;

struct SplTestPair {
    lb_pair: Pubkey,
    reserve_x: Pubkey,
    reserve_y: Pubkey,
    token_x_mint: Pubkey,
    token_y_mint: Pubkey,
    oracle: Pubkey,
    bin_array_1: Pubkey,
    bin_array_2: Pubkey,
}

fn setup_spl_test_pair() -> (ProgramTest, SplTestPair) {
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    test.add_program("./tests/artifacts/lb_clmm_prod", dlmm_interface::id(), None);

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
        dlmm_interface::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/lb_pair.bin",
    );

    test.add_account_with_file_data(
        oracle,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/oracle.bin",
    );

    test.add_account_with_file_data(
        bin_array_1,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
        "EtAdVRLFH22rjWh3mcUasKFF27WtHhsaCvK27tPFFWig/bin_array_1.bin",
    );

    test.add_account_with_file_data(
        bin_array_2,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
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

    (
        test,
        SplTestPair {
            lb_pair,
            reserve_x,
            reserve_y,
            token_x_mint,
            token_y_mint,
            oracle,
            bin_array_1,
            bin_array_2,
        },
    )
}

#[tokio::test]
async fn test_swap_exact_out() {
    let (
        test,
        SplTestPair {
            lb_pair,
            reserve_x,
            reserve_y,
            token_x_mint,
            token_y_mint,
            oracle,
            bin_array_1,
            bin_array_2,
        },
    ) = setup_spl_test_pair();

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    warp_sol(
        &payer,
        payer.pubkey(),
        1 * LAMPORTS_PER_SOL,
        &mut banks_client,
    )
    .await;

    let user_token_in =
        get_or_create_ata(&payer, &token_y_mint, &payer.pubkey(), &mut banks_client).await;

    let user_token_out =
        get_or_create_ata(&payer, &token_x_mint, &payer.pubkey(), &mut banks_client).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let lb_pair_account = banks_client
        .get_account(lb_pair)
        .await
        .ok()
        .flatten()
        .unwrap();

    let lb_pair_state = LbPairAccount::deserialize(&lb_pair_account.data).unwrap().0;

    let bin_array_1_account = banks_client
        .get_account(bin_array_1)
        .await
        .ok()
        .flatten()
        .unwrap();

    let bin_array_1_state = BinArrayAccount::deserialize(&bin_array_1_account.data)
        .unwrap()
        .0;

    let bin_array_2_account = banks_client
        .get_account(bin_array_2)
        .await
        .ok()
        .flatten()
        .unwrap();

    let bin_array_2_state = BinArrayAccount::deserialize(&bin_array_2_account.data)
        .unwrap()
        .0;

    let mut bin_arrays = HashMap::new();
    bin_arrays.insert(bin_array_1, bin_array_1_state);
    bin_arrays.insert(bin_array_2, bin_array_2_state);

    let clock = get_clock(&mut banks_client).await;

    let out_amount = 1_000_000;

    let mint_x_account = banks_client
        .get_account(lb_pair_state.token_x_mint)
        .await
        .ok()
        .flatten()
        .unwrap();

    let mint_y_account = banks_client
        .get_account(lb_pair_state.token_y_mint)
        .await
        .ok()
        .flatten()
        .unwrap();

    let quote_result = commons::quote::quote_exact_out(
        lb_pair,
        &lb_pair_state,
        out_amount,
        false,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    println!("quote_result {:?}", quote_result);

    let user_token_out_account_before = banks_client
        .get_account(user_token_out)
        .await
        .ok()
        .flatten()
        .unwrap();

    let user_token_in_account_before = banks_client
        .get_account(user_token_in)
        .await
        .ok()
        .flatten()
        .unwrap();

    let user_token_in_state_before =
        TokenAccount::try_deserialize(&mut user_token_in_account_before.data.as_ref()).unwrap();

    let user_token_out_state_before =
        TokenAccount::try_deserialize(&mut user_token_out_account_before.data.as_ref()).unwrap();

    let main_accounts: [AccountMeta; SWAP2_IX_ACCOUNTS_LEN] = dlmm_interface::Swap2Keys {
        lb_pair,
        oracle,
        bin_array_bitmap_extension: dlmm_interface::ID,
        reserve_x,
        reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint,
        token_y_mint,
        host_fee_in: dlmm_interface::ID,
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm_interface::id(),
        event_authority,
        memo_program: spl_memo::ID,
    }
    .into();

    let mut all_accounts = main_accounts.to_vec();

    let mut remaining_accounts = vec![
        AccountMeta::new(bin_array_1, false),
        AccountMeta::new(bin_array_2, false),
    ];
    all_accounts.append(&mut remaining_accounts);

    let swap_ix = Instruction {
        program_id: dlmm_interface::id(),
        accounts: all_accounts,
        data: dlmm_interface::SwapExactOut2IxData(SwapExactOut2IxArgs {
            max_in_amount: quote_result.amount_in,
            out_amount,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        })
        .try_to_vec()
        .unwrap(),
    };

    process_and_assert_ok(&[swap_ix], &payer, &[&payer], &mut banks_client).await;

    let user_token_out_account_after = banks_client
        .get_account(user_token_out)
        .await
        .ok()
        .flatten()
        .unwrap();

    let user_token_in_account_after = banks_client
        .get_account(user_token_in)
        .await
        .ok()
        .flatten()
        .unwrap();

    let user_token_out_state_after =
        TokenAccount::try_deserialize(&mut user_token_out_account_after.data.as_ref()).unwrap();

    let user_token_in_state_after =
        TokenAccount::try_deserialize(&mut user_token_in_account_after.data.as_ref()).unwrap();

    assert_eq!(
        user_token_in_state_before.amount - user_token_in_state_after.amount,
        quote_result.amount_in
    );

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        out_amount
    );
}

#[tokio::test]
async fn test_swap() {
    let (
        test,
        SplTestPair {
            lb_pair,
            reserve_x,
            reserve_y,
            token_x_mint,
            token_y_mint,
            oracle,
            bin_array_1,
            bin_array_2,
        },
    ) = setup_spl_test_pair();

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    let amount_in = 100_000;

    warp_sol(&payer, payer.pubkey(), amount_in, &mut banks_client).await;

    let user_token_in =
        get_or_create_ata(&payer, &token_y_mint, &payer.pubkey(), &mut banks_client).await;

    let user_token_out =
        get_or_create_ata(&payer, &token_x_mint, &payer.pubkey(), &mut banks_client).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let lb_pair_account = banks_client
        .get_account(lb_pair)
        .await
        .ok()
        .flatten()
        .unwrap();

    let lb_pair_state = LbPairAccount::deserialize(&lb_pair_account.data).unwrap().0;

    let bin_array_1_account = banks_client
        .get_account(bin_array_1)
        .await
        .ok()
        .flatten()
        .unwrap();

    let bin_array_1_state = BinArrayAccount::deserialize(&bin_array_1_account.data)
        .unwrap()
        .0;

    let bin_array_2_account = banks_client
        .get_account(bin_array_2)
        .await
        .ok()
        .flatten()
        .unwrap();

    let bin_array_2_state = BinArrayAccount::deserialize(&bin_array_2_account.data)
        .unwrap()
        .0;

    let mut bin_arrays = HashMap::new();
    bin_arrays.insert(bin_array_1, bin_array_1_state);
    bin_arrays.insert(bin_array_2, bin_array_2_state);

    let clock = get_clock(&mut banks_client).await;

    let mint_x_account = banks_client
        .get_account(lb_pair_state.token_x_mint)
        .await
        .ok()
        .flatten()
        .unwrap();

    let mint_y_account = banks_client
        .get_account(lb_pair_state.token_y_mint)
        .await
        .ok()
        .flatten()
        .unwrap();

    let quote_result = commons::quote::quote_exact_in(
        lb_pair,
        &lb_pair_state,
        amount_in,
        false,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    println!("quote_result {:?}", quote_result);

    let user_token_out_account_before = banks_client
        .get_account(user_token_out)
        .await
        .ok()
        .flatten()
        .unwrap();

    let user_token_out_state_before =
        TokenAccount::try_deserialize(&mut user_token_out_account_before.data.as_ref()).unwrap();

    let main_accounts: [AccountMeta; SWAP2_IX_ACCOUNTS_LEN] = dlmm_interface::Swap2Keys {
        lb_pair,
        oracle,
        bin_array_bitmap_extension: dlmm_interface::ID,
        reserve_x,
        reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint,
        token_y_mint,
        host_fee_in: dlmm_interface::ID,
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm_interface::id(),
        event_authority,
        memo_program: spl_memo::id(),
    }
    .into();

    let mut all_accounts = main_accounts.to_vec();

    let mut remaining_accounts = vec![
        AccountMeta::new(bin_array_1, false),
        AccountMeta::new(bin_array_2, false),
    ];
    all_accounts.append(&mut remaining_accounts);

    let swap_ix = Instruction {
        program_id: dlmm_interface::id(),
        accounts: all_accounts,
        data: dlmm_interface::Swap2IxData(Swap2IxArgs {
            amount_in,
            min_amount_out: 0,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        })
        .try_to_vec()
        .unwrap(),
    };

    process_and_assert_ok(&[swap_ix], &payer, &[&payer], &mut banks_client).await;

    let user_token_out_account_after = banks_client
        .get_account(user_token_out)
        .await
        .ok()
        .flatten()
        .unwrap();

    let user_token_out_state_after =
        TokenAccount::try_deserialize(&mut user_token_out_account_after.data.as_ref()).unwrap();

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        quote_result.amount_out
    );
}
