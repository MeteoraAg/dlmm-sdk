use crate::*;
use commons::dlmm::accounts::BinArray;
use solana_sdk::signature::Keypair;
use std::collections::HashMap;
use std::rc::Rc;

const FIXTURE_FOLDER: &str = "9t3EyC9FweyL7PBWvKz3mrXg8B9fwFc9SK3QxM4ENqhd";

struct SwapQuoteTestPair {
    lb_pair: Pubkey,
    reserve_x: Pubkey,
    reserve_y: Pubkey,
    token_x_mint: Pubkey,
    token_y_mint: Pubkey,
    oracle: Pubkey,
    bin_array_1: Pubkey,
    bin_array_2: Pubkey,
    mint_authority: Keypair,
}

fn setup_swap_quote_test_pair() -> (ProgramTest, SwapQuoteTestPair) {
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    test.add_program("./tests/artifacts/lb_clmm_prod", dlmm::ID, None);

    let lb_pair = Pubkey::from_str_const("9t3EyC9FweyL7PBWvKz3mrXg8B9fwFc9SK3QxM4ENqhd");
    let reserve_x = Pubkey::from_str_const("DDVpGjEz7Ay6QSyCJX5FpJhnYYYFUJ5kNdwy3ZrQP9u6");
    let reserve_y = Pubkey::from_str_const("9LqVUn45rtZqMmNSr7wSpJUy2Qqd6VE5q3QN7t7oJL8v");
    let token_x_mint = Pubkey::from_str_const("BBZU4HYvY4qMGE5MbWsVxGweGBZJqGRsgH8tAEAKusNk");
    let token_y_mint = Pubkey::from_str_const("31iVdsS8fkURXg737XQwYhXVAuGv2vNYHjyDiURStkaU");
    let oracle = Pubkey::from_str_const("FviPunh9kSt1XRBdHiWd5FNdTe5MJmqGfSEQdNfHTQV4");
    // bin_array_1 = index -1 (bins -70 to -1)
    let bin_array_1 = Pubkey::from_str_const("338HBraHxVupeftangX6jySecbND4osxcJjjMSW7qmMs");
    // bin_array_2 = index 0 (bins 0 to 69)
    let bin_array_2 = Pubkey::from_str_const("28BX6QycwTKx3CqswpJQs7hJCmoUs469Qt4maKMdhgmQ");

    let mint_authority = Keypair::new();

    test.add_account_with_file_data(
        lb_pair,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        &format!("{FIXTURE_FOLDER}/lb_pair.bin"),
    );

    test.add_account_with_file_data(
        oracle,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        &format!("{FIXTURE_FOLDER}/oracle.bin"),
    );

    test.add_account_with_file_data(
        bin_array_1,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        &format!("{FIXTURE_FOLDER}/bin_array_1.bin"),
    );

    test.add_account_with_file_data(
        bin_array_2,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        &format!("{FIXTURE_FOLDER}/bin_array_2.bin"),
    );

    test.add_account_with_file_data(
        reserve_x,
        10 * LAMPORTS_PER_SOL,
        spl_token::id(),
        &format!("{FIXTURE_FOLDER}/reserve_x.bin"),
    );

    test.add_account_with_file_data(
        reserve_y,
        10 * LAMPORTS_PER_SOL,
        spl_token::id(),
        &format!("{FIXTURE_FOLDER}/reserve_y.bin"),
    );

    // Patch mint authority to our test keypair so we can mint tokens to users
    for (mint_pubkey, filename) in [
        (token_x_mint, "token_x_mint.bin"),
        (token_y_mint, "token_y_mint.bin"),
    ] {
        let fixture_path = format!("tests/fixtures/{FIXTURE_FOLDER}/{filename}");
        let mut mint_data = std::fs::read(&fixture_path).unwrap();
        // SPL Mint layout: COption<Pubkey> tag(4) + pubkey(32) at offset 0
        mint_data[0..4].copy_from_slice(&1u32.to_le_bytes());
        mint_data[4..36].copy_from_slice(mint_authority.pubkey().as_ref());
        test.add_account(
            mint_pubkey,
            solana_sdk::account::Account {
                lamports: 10 * LAMPORTS_PER_SOL,
                data: mint_data,
                owner: spl_token::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
    }

    (
        test,
        SwapQuoteTestPair {
            lb_pair,
            reserve_x,
            reserve_y,
            token_x_mint,
            token_y_mint,
            oracle,
            bin_array_1,
            bin_array_2,
            mint_authority,
        },
    )
}

/// Build remaining accounts for swap: bin arrays in traversal order.
/// For swap_for_y=true (X→Y, left): active bin's array first, then lower index.
/// For swap_for_y=false (Y→X, right): active bin's array first, then higher index.
/// Active bin (id=0) is in bin_array_2 (index 0).
fn bin_array_remaining_accounts(pair: &SwapQuoteTestPair, swap_for_y: bool) -> Vec<AccountMeta> {
    if swap_for_y {
        // Going left: start at index 0, then need index -1
        vec![
            AccountMeta::new(pair.bin_array_2, false), // index 0 (active bin)
            AccountMeta::new(pair.bin_array_1, false), // index -1
        ]
    } else {
        // Going right: start at index 0, might need index -1 only if wrapping
        // but X liquidity is at positive bins (all in index 0), so index 0 first
        vec![
            AccountMeta::new(pair.bin_array_2, false), // index 0 (active bin + X bins)
            AccountMeta::new(pair.bin_array_1, false), // index -1
        ]
    }
}

// ---- Exact In Tests ----

/// Ask side: swap X -> Y (swap_for_y = true)
/// 40B X raw input consumes >5 bins of Y.
#[tokio::test]
async fn test_swap_exact_in_x_to_y_with_limit_order() {
    let (test, pair) = setup_swap_quote_test_pair();
    let mut ctx = test.start_with_context().await;
    let lb_pair_state = fetch_lb_pair(&mut ctx.banks_client, pair.lb_pair).await;
    ctx.warp_to_slot(lb_pair_state.activation_point + 1)
        .unwrap();
    let payer = Rc::new(ctx.payer);
    let mut banks_client = ctx.banks_client;

    let amount_in: u64 = 40_000_000_000;

    let user_token_in = get_or_create_ata(
        &payer,
        &pair.token_x_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;
    let user_token_out = get_or_create_ata(
        &payer,
        &pair.token_y_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;

    mint_spl_tokens(
        &payer,
        &pair.token_x_mint,
        &user_token_in,
        &pair.mint_authority,
        amount_in,
        &mut banks_client,
    )
    .await;

    let (lb_pair_state, bin_arrays, mint_x_account, mint_y_account, clock) = fetch_swap_state(
        &mut banks_client,
        pair.lb_pair,
        &[pair.bin_array_1, pair.bin_array_2],
    )
    .await;

    let swap_for_y = true;
    let quote_result = commons::quote::quote_exact_in(
        pair.lb_pair,
        &lb_pair_state,
        amount_in,
        swap_for_y,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    let user_token_in_state_before =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_before =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::Swap2 {
        lb_pair: pair.lb_pair,
        oracle: pair.oracle,
        bin_array_bitmap_extension: Some(dlmm::ID),
        reserve_x: pair.reserve_x,
        reserve_y: pair.reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint: pair.token_x_mint,
        token_y_mint: pair.token_y_mint,
        host_fee_in: Some(dlmm::ID),
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm::ID,
        event_authority,
        memo_program: spl_memo::id(),
    }
    .to_account_metas(None);

    let mut all_accounts = main_accounts.to_vec();
    all_accounts.extend(bin_array_remaining_accounts(&pair, swap_for_y));

    let swap_ix = Instruction {
        program_id: dlmm::ID,
        accounts: all_accounts,
        data: dlmm::client::args::Swap2 {
            amount_in,
            min_amount_out: 0,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };

    let active_bin_before = lb_pair_state.active_id;

    process_and_assert_ok(&[swap_ix], &payer, &[&*payer], &mut banks_client).await;

    let lb_pair_state_after = fetch_lb_pair(&mut banks_client, pair.lb_pair).await;
    let bin_delta = (active_bin_before - lb_pair_state_after.active_id).abs();
    assert!(
        bin_delta >= 5,
        "Active bin should move >= 5 bins, moved {}",
        bin_delta
    );

    let user_token_in_state_after =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_after =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    assert_eq!(
        user_token_in_state_before.amount - user_token_in_state_after.amount,
        amount_in,
        "Actual swap in amount must match requested amount_in"
    );

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        quote_result.amount_out,
        "Actual swap out amount must match quote"
    );
}

/// Bid side: swap Y -> X (swap_for_y = false)
/// 45T Y raw input consumes >5 bins of X.
#[tokio::test]
async fn test_swap_exact_in_y_to_x_with_limit_order() {
    let (test, pair) = setup_swap_quote_test_pair();
    let mut ctx = test.start_with_context().await;
    let lb_pair_state = fetch_lb_pair(&mut ctx.banks_client, pair.lb_pair).await;
    ctx.warp_to_slot(lb_pair_state.activation_point + 1)
        .unwrap();
    let payer = Rc::new(ctx.payer);
    let mut banks_client = ctx.banks_client;

    let amount_in: u64 = 45_000_000_000_000;

    let user_token_in = get_or_create_ata(
        &payer,
        &pair.token_y_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;
    let user_token_out = get_or_create_ata(
        &payer,
        &pair.token_x_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;

    mint_spl_tokens(
        &payer,
        &pair.token_y_mint,
        &user_token_in,
        &pair.mint_authority,
        amount_in,
        &mut banks_client,
    )
    .await;

    let (lb_pair_state, bin_arrays, mint_x_account, mint_y_account, clock) = fetch_swap_state(
        &mut banks_client,
        pair.lb_pair,
        &[pair.bin_array_1, pair.bin_array_2],
    )
    .await;

    let swap_for_y = false;
    let quote_result = commons::quote::quote_exact_in(
        pair.lb_pair,
        &lb_pair_state,
        amount_in,
        swap_for_y,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    let user_token_in_state_before =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_before =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::Swap2 {
        lb_pair: pair.lb_pair,
        oracle: pair.oracle,
        bin_array_bitmap_extension: Some(dlmm::ID),
        reserve_x: pair.reserve_x,
        reserve_y: pair.reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint: pair.token_x_mint,
        token_y_mint: pair.token_y_mint,
        host_fee_in: Some(dlmm::ID),
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm::ID,
        event_authority,
        memo_program: spl_memo::id(),
    }
    .to_account_metas(None);

    let mut all_accounts = main_accounts.to_vec();
    all_accounts.extend(bin_array_remaining_accounts(&pair, swap_for_y));

    let swap_ix = Instruction {
        program_id: dlmm::ID,
        accounts: all_accounts,
        data: dlmm::client::args::Swap2 {
            amount_in,
            min_amount_out: 0,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };

    let active_bin_before = lb_pair_state.active_id;

    process_and_assert_ok(&[swap_ix], &payer, &[&*payer], &mut banks_client).await;

    let lb_pair_state_after = fetch_lb_pair(&mut banks_client, pair.lb_pair).await;
    let bin_delta = (active_bin_before - lb_pair_state_after.active_id).abs();
    assert!(
        bin_delta >= 5,
        "Active bin should move >= 5 bins, moved {}",
        bin_delta
    );

    let user_token_in_state_after =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_after =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    assert_eq!(
        user_token_in_state_before.amount - user_token_in_state_after.amount,
        amount_in,
        "Actual swap in amount must match requested amount_in"
    );

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        quote_result.amount_out,
        "Actual swap out amount must match quote"
    );
}

// ---- Exact Out Tests ----

/// Ask side exact out: swap X -> Y, requesting exact Y output spanning >5 bins
#[tokio::test]
async fn test_swap_exact_out_x_to_y_with_limit_order() {
    let (test, pair) = setup_swap_quote_test_pair();
    let mut ctx = test.start_with_context().await;
    let lb_pair_state = fetch_lb_pair(&mut ctx.banks_client, pair.lb_pair).await;
    ctx.warp_to_slot(lb_pair_state.activation_point + 1)
        .unwrap();
    let payer = Rc::new(ctx.payer);
    let mut banks_client = ctx.banks_client;

    // Each Y bin has ~6,451,612,902 units. Request ~6 bins worth.
    let out_amount: u64 = 38_000_000_000;
    let mint_amount: u64 = 100_000_000_000;

    let user_token_in = get_or_create_ata(
        &payer,
        &pair.token_x_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;
    let user_token_out = get_or_create_ata(
        &payer,
        &pair.token_y_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;

    mint_spl_tokens(
        &payer,
        &pair.token_x_mint,
        &user_token_in,
        &pair.mint_authority,
        mint_amount,
        &mut banks_client,
    )
    .await;

    let (lb_pair_state, bin_arrays, mint_x_account, mint_y_account, clock) = fetch_swap_state(
        &mut banks_client,
        pair.lb_pair,
        &[pair.bin_array_1, pair.bin_array_2],
    )
    .await;

    let swap_for_y = true;
    let quote_result = commons::quote::quote_exact_out(
        pair.lb_pair,
        &lb_pair_state,
        out_amount,
        swap_for_y,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    let user_token_in_state_before =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_before =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::SwapExactOut2 {
        lb_pair: pair.lb_pair,
        oracle: pair.oracle,
        bin_array_bitmap_extension: Some(dlmm::ID),
        reserve_x: pair.reserve_x,
        reserve_y: pair.reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint: pair.token_x_mint,
        token_y_mint: pair.token_y_mint,
        host_fee_in: Some(dlmm::ID),
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm::ID,
        event_authority,
        memo_program: spl_memo::ID,
    }
    .to_account_metas(None);

    let mut all_accounts = main_accounts.to_vec();
    all_accounts.extend(bin_array_remaining_accounts(&pair, swap_for_y));

    let swap_ix = Instruction {
        program_id: dlmm::ID,
        accounts: all_accounts,
        data: dlmm::client::args::SwapExactOut2 {
            max_in_amount: u64::MAX,
            out_amount,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };

    let active_bin_before = lb_pair_state.active_id;

    process_and_assert_ok(&[swap_ix], &payer, &[&*payer], &mut banks_client).await;

    let lb_pair_state_after = fetch_lb_pair(&mut banks_client, pair.lb_pair).await;
    let bin_delta = (active_bin_before - lb_pair_state_after.active_id).abs();
    assert!(
        bin_delta >= 5,
        "Active bin should move >= 5 bins, moved {}",
        bin_delta
    );

    let user_token_in_state_after =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_after =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    assert_eq!(
        user_token_in_state_before.amount - user_token_in_state_after.amount,
        quote_result.amount_in,
        "Actual swap in amount must match quote"
    );

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        out_amount,
        "Actual swap out amount must equal requested out_amount"
    );
}

/// Bid side exact out: swap Y -> X, requesting exact X output spanning >5 bins
#[tokio::test]
async fn test_swap_exact_out_y_to_x_with_limit_order() {
    let (test, pair) = setup_swap_quote_test_pair();
    let mut ctx = test.start_with_context().await;
    let lb_pair_state = fetch_lb_pair(&mut ctx.banks_client, pair.lb_pair).await;
    ctx.warp_to_slot(lb_pair_state.activation_point + 1)
        .unwrap();
    let payer = Rc::new(ctx.payer);
    let mut banks_client = ctx.banks_client;

    // Each X bin has ~6,750,000,000,000 units. Request ~6 bins worth.
    let out_amount: u64 = 40_000_000_000_000;
    let mint_amount: u64 = 50_000_000_000_000;

    let user_token_in = get_or_create_ata(
        &payer,
        &pair.token_y_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;
    let user_token_out = get_or_create_ata(
        &payer,
        &pair.token_x_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;

    mint_spl_tokens(
        &payer,
        &pair.token_y_mint,
        &user_token_in,
        &pair.mint_authority,
        mint_amount,
        &mut banks_client,
    )
    .await;

    let (lb_pair_state, bin_arrays, mint_x_account, mint_y_account, clock) = fetch_swap_state(
        &mut banks_client,
        pair.lb_pair,
        &[pair.bin_array_1, pair.bin_array_2],
    )
    .await;

    let swap_for_y = false;
    let quote_result = commons::quote::quote_exact_out(
        pair.lb_pair,
        &lb_pair_state,
        out_amount,
        swap_for_y,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    let user_token_in_state_before =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_before =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::SwapExactOut2 {
        lb_pair: pair.lb_pair,
        oracle: pair.oracle,
        bin_array_bitmap_extension: Some(dlmm::ID),
        reserve_x: pair.reserve_x,
        reserve_y: pair.reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint: pair.token_x_mint,
        token_y_mint: pair.token_y_mint,
        host_fee_in: Some(dlmm::ID),
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm::ID,
        event_authority,
        memo_program: spl_memo::ID,
    }
    .to_account_metas(None);

    let mut all_accounts = main_accounts.to_vec();
    all_accounts.extend(bin_array_remaining_accounts(&pair, swap_for_y));

    let swap_ix = Instruction {
        program_id: dlmm::ID,
        accounts: all_accounts,
        data: dlmm::client::args::SwapExactOut2 {
            max_in_amount: u64::MAX,
            out_amount,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };

    let active_bin_before = lb_pair_state.active_id;

    process_and_assert_ok(&[swap_ix], &payer, &[&*payer], &mut banks_client).await;

    let lb_pair_state_after = fetch_lb_pair(&mut banks_client, pair.lb_pair).await;
    let bin_delta = (active_bin_before - lb_pair_state_after.active_id).abs();
    assert!(
        bin_delta >= 5,
        "Active bin should move >= 5 bins, moved {}",
        bin_delta
    );

    let user_token_in_state_after =
        fetch_token_account_state(&mut banks_client, user_token_in).await;

    let user_token_out_state_after =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    assert_eq!(
        user_token_in_state_before.amount - user_token_in_state_after.amount,
        quote_result.amount_in,
        "Actual swap in amount must match quote"
    );

    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        out_amount,
        "Actual swap out amount must equal requested out_amount"
    );
}

enum ActiveBinOutKind {
    MmOnly,
    MmPlusProcessed,
    MmPlusProcessedPlusOpen,
}

async fn run_swap_exact_out_active_bin_partition(kind: ActiveBinOutKind) {
    let (test, pair) = setup_swap_quote_test_pair();
    let mut ctx = test.start_with_context().await;
    let lb_pair_state = fetch_lb_pair(&mut ctx.banks_client, pair.lb_pair).await;
    ctx.warp_to_slot(lb_pair_state.activation_point + 1)
        .unwrap();
    let payer = Rc::new(ctx.payer);
    let mut banks_client = ctx.banks_client;

    let mint_amount: u64 = 100_000_000_000_000;

    let user_token_in = get_or_create_ata(
        &payer,
        &pair.token_x_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;
    let user_token_out = get_or_create_ata(
        &payer,
        &pair.token_y_mint,
        &payer.pubkey(),
        &mut banks_client,
    )
    .await;

    mint_spl_tokens(
        &payer,
        &pair.token_x_mint,
        &user_token_in,
        &pair.mint_authority,
        mint_amount,
        &mut banks_client,
    )
    .await;

    let (lb_pair_state, bin_arrays, mint_x_account, mint_y_account, clock) = fetch_swap_state(
        &mut banks_client,
        pair.lb_pair,
        &[pair.bin_array_1, pair.bin_array_2],
    )
    .await;

    let swap_for_y = true;

    let active_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id).unwrap();
    let pubkey = derive_bin_array_pda(pair.lb_pair, active_idx.into()).0;

    let active_bin_array = bin_arrays
        .get(&pubkey)
        .expect("active bin array not loaded");
    let active_bin = active_bin_array.get_bin(lb_pair_state.active_id).unwrap();

    let mm_y = active_bin.amount_y;
    let (open, processed) = active_bin.get_limit_order_amounts_by_direction(swap_for_y);

    let out_amount = match kind {
        ActiveBinOutKind::MmOnly => mm_y,
        ActiveBinOutKind::MmPlusProcessed => mm_y + processed,
        ActiveBinOutKind::MmPlusProcessedPlusOpen => mm_y + processed + open,
    };

    assert!(
        out_amount > 0,
        "active-bin out_amount must be > 0; mm={}, processed={}, open={}",
        mm_y,
        processed,
        open
    );

    let quote_result = commons::quote::quote_exact_out(
        pair.lb_pair,
        &lb_pair_state,
        out_amount,
        swap_for_y,
        bin_arrays,
        None,
        &clock,
        &mint_x_account,
        &mint_y_account,
    )
    .unwrap();

    let user_token_in_state_before =
        fetch_token_account_state(&mut banks_client, user_token_in).await;
    let user_token_out_state_before =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::SwapExactOut2 {
        lb_pair: pair.lb_pair,
        oracle: pair.oracle,
        bin_array_bitmap_extension: Some(dlmm::ID),
        reserve_x: pair.reserve_x,
        reserve_y: pair.reserve_y,
        user_token_in,
        user_token_out,
        token_x_mint: pair.token_x_mint,
        token_y_mint: pair.token_y_mint,
        host_fee_in: Some(dlmm::ID),
        user: payer.pubkey(),
        token_x_program: spl_token::id(),
        token_y_program: spl_token::id(),
        program: dlmm::ID,
        event_authority,
        memo_program: spl_memo::ID,
    }
    .to_account_metas(None);

    let mut all_accounts = main_accounts.to_vec();
    all_accounts.extend(bin_array_remaining_accounts(&pair, swap_for_y));

    let swap_ix = Instruction {
        program_id: dlmm::ID,
        accounts: all_accounts,
        data: dlmm::client::args::SwapExactOut2 {
            max_in_amount: u64::MAX,
            out_amount,
            remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
        }
        .data(),
    };

    process_and_assert_ok(&[swap_ix], &payer, &[&*payer], &mut banks_client).await;

    let user_token_in_state_after =
        fetch_token_account_state(&mut banks_client, user_token_in).await;
    let user_token_out_state_after =
        fetch_token_account_state(&mut banks_client, user_token_out).await;

    assert_eq!(
        user_token_in_state_before.amount - user_token_in_state_after.amount,
        quote_result.amount_in,
        "Actual swap in amount must match quote.amount_in",
    );
    assert_eq!(
        user_token_out_state_after.amount - user_token_out_state_before.amount,
        out_amount,
        "Actual swap out amount must equal requested out_amount",
    );
}

#[tokio::test]
async fn test_swap_exact_out_mm_liquidity_only_active_bin() {
    run_swap_exact_out_active_bin_partition(ActiveBinOutKind::MmOnly).await;
}

#[tokio::test]
async fn test_swap_exact_out_mm_plus_processed_active_bin() {
    run_swap_exact_out_active_bin_partition(ActiveBinOutKind::MmPlusProcessed).await;
}

#[tokio::test]
async fn test_swap_exact_out_mm_plus_processed_plus_open_active_bin() {
    run_swap_exact_out_active_bin_partition(ActiveBinOutKind::MmPlusProcessedPlusOpen).await;
}
