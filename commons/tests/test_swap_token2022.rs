mod helpers;
use anchor_client::anchor_lang::AccountDeserialize;
use anchor_spl::token::spl_token;
use anchor_spl::token_2022::spl_token_2022;
use anchor_spl::token_interface::TokenAccount;
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
    test.add_program("./tests/artifacts/lb_clmm_prod", dlmm_interface::id(), None);
    test.add_program("./tests/artifacts/token_2022", spl_token_2022::id(), None);

    let lb_pair = Pubkey::from_str("B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc").unwrap();
    let reserve_x = Pubkey::from_str("HmAJViUS3iMSzuedDs1z4QxAPitnK8oNC6dwAaNrRTBE").unwrap();
    let reserve_y = Pubkey::from_str("2LAbjR3C5pWMVKh7HUWyEZ6wwubHwHB6B91vu5jaB3mr").unwrap();
    let token_x_mint = Pubkey::from_str("B4rGSdcBrmLEPUQXpZa91PMsRE3GqNcjLd6EMvM3yaj2").unwrap();
    let token_y_mint = anchor_spl::token::spl_token::native_mint::id();
    let oracle = Pubkey::from_str("HeC6TwhrT9eusRp8wMWuswpMAp1eUmr4mUB5csYMPsjU").unwrap();
    let bin_array_1 = Pubkey::from_str("4adaMF2BRtenYAtsQfJCYjR5NG3B1GU6twc7eosKr7rL").unwrap();
    let bin_array_2 = Pubkey::from_str("9Tp5Ym4rH1sEmwkQcjVHyXvaY5zCwVGofYSdcH4WETVJ").unwrap();

    test.add_account_with_file_data(
        lb_pair,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/lb_pair.bin",
    );

    test.add_account_with_file_data(
        oracle,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/oracle.bin",
    );

    test.add_account_with_file_data(
        bin_array_1,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/bin_array_1.bin",
    );

    test.add_account_with_file_data(
        bin_array_2,
        10 * LAMPORTS_PER_SOL,
        dlmm_interface::id(),
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/bin_array_2.bin",
    );

    test.add_account_with_file_data(
        token_x_mint,
        10 * LAMPORTS_PER_SOL,
        spl_token_2022::id(),
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/token_x_mint.bin",
    );

    test.add_account_with_file_data(
        reserve_x,
        10 * LAMPORTS_PER_SOL,
        spl_token_2022::id(),
        "B5Eia4cE71tKuEDaqPHucJLG2fxySKyKzLMewd2nUvoc/reserve_x.bin",
    );

    test.add_account_with_file_data(
        reserve_y,
        10 * LAMPORTS_PER_SOL,
        spl_token::id(),
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
            token_x_program: spl_token_2022::id(),
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
            token_x_program: spl_token_2022::id(),
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
            data: dlmm_interface::Swap2IxData(Swap2IxArgs {
                amount_in,
                min_amount_out: quote_result.amount_out,
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
}
