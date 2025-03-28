use crate::*;

struct Token2022TestPair {
    lb_pair: Pubkey,
    reserve_x: Pubkey,
    reserve_y: Pubkey,
    token_x_mint: Pubkey,
    token_y_mint: Pubkey,
    oracle: Pubkey,
    bin_array_1: Pubkey,
    bin_array_2: Pubkey,
}

fn setup_token_2022_test_pair() -> (ProgramTest, Token2022TestPair) {
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    test.add_program("./tests/artifacts/lb_clmm_prod", dlmm::ID, None);
    test.add_program("./tests/artifacts/token_2022", spl_token_2022::ID, None);

    let lb_pair = Pubkey::from_str_const("B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc");
    let reserve_x = Pubkey::from_str_const("HmAJViUS3iMSzuedDs1z4QxAPitnK8oNC6dwAaNrRTBE");
    let reserve_y = Pubkey::from_str_const("2LAbjR3C5pWMVKh7HUWyEZ6wwubHwHB6B91vu5jaB3mr");
    let token_x_mint = Pubkey::from_str_const("B4rGSdcBrmLEPUQXpZa91PMsRE3GqNcjLd6EMvM3yaj2");
    let token_y_mint = anchor_spl::token::spl_token::native_mint::ID;
    let oracle = Pubkey::from_str_const("HeC6TwhrT9eusRp8wMWuswpMAp1eUmr4mUB5csYMPsjU");
    let bin_array_1 = Pubkey::from_str_const("4adaMF2BRtenYAtsQfJCYjR5NG3B1GU6twc7eosKr7rL");
    let bin_array_2 = Pubkey::from_str_const("9Tp5Ym4rH1sEmwkQcjVHyXvaY5zCwVGofYSdcH4WETVJ");

    test.add_account_with_file_data(
        lb_pair,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/lb_pair.bin",
    );

    test.add_account_with_file_data(
        oracle,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/oracle.bin",
    );

    test.add_account_with_file_data(
        bin_array_1,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/bin_array_1.bin",
    );

    test.add_account_with_file_data(
        bin_array_2,
        10 * LAMPORTS_PER_SOL,
        dlmm::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/bin_array_2.bin",
    );

    test.add_account_with_file_data(
        token_x_mint,
        10 * LAMPORTS_PER_SOL,
        spl_token_2022::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/token_x_mint.bin",
    );

    test.add_account_with_file_data(
        reserve_x,
        10 * LAMPORTS_PER_SOL,
        spl_token_2022::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/reserve_x.bin",
    );

    test.add_account_with_file_data(
        reserve_y,
        10 * LAMPORTS_PER_SOL,
        spl_token::ID,
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/reserve_y.bin",
    );

    (
        test,
        Token2022TestPair {
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
        Token2022TestPair {
            lb_pair,
            reserve_x,
            reserve_y,
            token_x_mint,
            token_y_mint,
            oracle,
            bin_array_1,
            bin_array_2,
        },
    ) = setup_token_2022_test_pair();

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    warp_sol(
        &payer,
        payer.pubkey(),
        1 * LAMPORTS_PER_SOL,
        &mut banks_client,
    )
    .await;

    for (in_mint, out_mint, out_amount) in [
        (token_y_mint, token_x_mint, 10_000_000),
        (token_x_mint, token_y_mint, 1_000_000),
    ] {
        let user_token_in =
            get_or_create_ata(&payer, &in_mint, &payer.pubkey(), &mut banks_client).await;

        let user_token_out =
            get_or_create_ata(&payer, &out_mint, &payer.pubkey(), &mut banks_client).await;

        let (event_authority, _bump) = derive_event_authority_pda();

        let lb_pair_account = banks_client
            .get_account(lb_pair)
            .await
            .ok()
            .flatten()
            .unwrap();

        let lb_pair_state = LbPair::try_deserialize(&mut lb_pair_account.data.as_ref()).unwrap();

        let bin_array_1_account = banks_client
            .get_account(bin_array_1)
            .await
            .ok()
            .flatten()
            .unwrap();

        let bin_array_1_state =
            BinArray::try_deserialize(&mut bin_array_1_account.data.as_ref()).unwrap();

        let bin_array_2_account = banks_client
            .get_account(bin_array_2)
            .await
            .ok()
            .flatten()
            .unwrap();

        let bin_array_2_state =
            BinArray::try_deserialize(&mut bin_array_2_account.data.as_ref()).unwrap();

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

        let swap_for_y = out_mint == lb_pair_state.token_y_mint;

        let quote_result = commons::quote::quote_exact_out(
            lb_pair,
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
            TokenAccount::try_deserialize(&mut user_token_out_account_before.data.as_ref())
                .unwrap();

        let main_accounts = dlmm::client::accounts::SwapExactOut2 {
            lb_pair,
            oracle,
            bin_array_bitmap_extension: Some(dlmm::ID),
            reserve_x,
            reserve_y,
            user_token_in,
            user_token_out,
            token_x_mint,
            token_y_mint,
            host_fee_in: Some(dlmm::ID),
            user: payer.pubkey(),
            token_x_program: spl_token_2022::ID,
            token_y_program: spl_token::ID,
            program: dlmm::ID,
            event_authority,
            memo_program: spl_memo::ID,
        }
        .to_account_metas(None);

        let mut all_accounts = main_accounts.to_vec();

        let mut remaining_accounts = vec![
            AccountMeta::new(bin_array_1, false),
            AccountMeta::new(bin_array_2, false),
        ];
        all_accounts.append(&mut remaining_accounts);

        let swap_ix = Instruction {
            program_id: dlmm::ID,
            accounts: all_accounts,
            data: dlmm::client::args::SwapExactOut2 {
                max_in_amount: quote_result.amount_in,
                out_amount,
                remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
            }
            .data(),
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
}

#[tokio::test]
async fn test_swap() {
    let (
        test,
        Token2022TestPair {
            lb_pair,
            reserve_x,
            reserve_y,
            token_x_mint,
            token_y_mint,
            oracle,
            bin_array_1,
            bin_array_2,
        },
    ) = setup_token_2022_test_pair();

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    warp_sol(
        &payer,
        payer.pubkey(),
        1 * LAMPORTS_PER_SOL,
        &mut banks_client,
    )
    .await;

    for (in_mint, out_mint, amount_in) in [
        (token_y_mint, token_x_mint, 10_000_000),
        (token_x_mint, token_y_mint, 1_000_000),
    ] {
        let user_token_in =
            get_or_create_ata(&payer, &in_mint, &payer.pubkey(), &mut banks_client).await;

        let user_token_out =
            get_or_create_ata(&payer, &out_mint, &payer.pubkey(), &mut banks_client).await;

        let (event_authority, _bump) = derive_event_authority_pda();

        let lb_pair_account = banks_client
            .get_account(lb_pair)
            .await
            .ok()
            .flatten()
            .unwrap();

        let lb_pair_state = LbPair::try_deserialize(&mut lb_pair_account.data.as_ref()).unwrap();

        let bin_array_1_account = banks_client
            .get_account(bin_array_1)
            .await
            .ok()
            .flatten()
            .unwrap();

        let bin_array_1_state =
            BinArray::try_deserialize(&mut bin_array_1_account.data.as_ref()).unwrap();

        let bin_array_2_account = banks_client
            .get_account(bin_array_2)
            .await
            .ok()
            .flatten()
            .unwrap();

        let bin_array_2_state =
            BinArray::try_deserialize(&mut bin_array_2_account.data.as_ref()).unwrap();

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

        let swap_for_y = out_mint == lb_pair_state.token_y_mint;

        let quote_result = commons::quote::quote_exact_in(
            lb_pair,
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

        println!("quote_result {:?}", quote_result);

        let user_token_out_account_before = banks_client
            .get_account(user_token_out)
            .await
            .ok()
            .flatten()
            .unwrap();

        let user_token_out_state_before =
            TokenAccount::try_deserialize(&mut user_token_out_account_before.data.as_ref())
                .unwrap();

        let main_accounts = dlmm::client::accounts::Swap2 {
            lb_pair,
            oracle,
            bin_array_bitmap_extension: Some(dlmm::ID),
            reserve_x,
            reserve_y,
            user_token_in,
            user_token_out,
            token_x_mint,
            token_y_mint,
            host_fee_in: Some(dlmm::ID),
            user: payer.pubkey(),
            token_x_program: spl_token_2022::ID,
            token_y_program: spl_token::ID,
            program: dlmm::ID,
            event_authority,
            memo_program: spl_memo::ID,
        }
        .to_account_metas(None);

        let mut all_accounts = main_accounts.to_vec();

        let mut remaining_accounts = vec![
            AccountMeta::new(bin_array_1, false),
            AccountMeta::new(bin_array_2, false),
        ];
        all_accounts.append(&mut remaining_accounts);

        let swap_ix = Instruction {
            program_id: dlmm::ID,
            accounts: all_accounts,
            data: dlmm::client::args::Swap2 {
                amount_in,
                min_amount_out: quote_result.amount_out,
                remaining_accounts_info: RemainingAccountsInfo { slices: vec![] },
            }
            .data(),
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
}
