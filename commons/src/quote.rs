    #[tokio::test]
    async fn test_swap_quote_exact_in() {
        // RPC client. No gPA is required.
        let rpc_client = RpcClient::new(Cluster::Mainnet.url().to_string());

        let client = Client::new(
            Cluster::Custom(rpc_client.url(), rpc_client.url()),
            Rc::new(Keypair::new()),
        );

        let _program = client.program(lb_clmm::ID).unwrap();

        let sol_usdc = Pubkey::from_str("HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR").unwrap();

        // Get account data and deserialize properly with alignment handling
        let account = rpc_client.get_account(&sol_usdc).await.unwrap();
        let mut data = account.data.as_slice();
        let lb_pair = LbPair::try_deserialize(&mut data).unwrap();

        // 3 bin arrays to left, and right is enough to cover most of the swap, and stay under 1.4m CU constraint.
        // Get 3 bin arrays to the left from the active bin
        let left_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(sol_usdc, &lb_pair, None, true, 3).unwrap();

        // Get 3 bin arrays to the right from active bin
        let right_bin_array_pubkeys =
            get_bin_array_pubkeys_for_swap(sol_usdc, &lb_pair, None, false, 3).unwrap();

        // Fetch bin arrays
        let bin_array_pubkeys = left_bin_array_pubkeys
            .into_iter()
            .chain(right_bin_array_pubkeys.into_iter())
            .collect::<Vec<Pubkey>>();

        let accounts = rpc_client
            .get_multiple_accounts(&bin_array_pubkeys)
            .await
            .unwrap();

        let bin_arrays = accounts
            .into_iter()
            .zip(bin_array_pubkeys.into_iter())
            .filter_map(|(account, key)| {
                account.map(|acc| {
                    let mut data = acc.data.as_slice();
                    (
                        key,
                        BinArray::try_deserialize(&mut data).unwrap(),
                    )
                })
            })
            .collect::<HashMap<_, _>>();

        // 1 SOL -> USDC
        let in_sol_amount = 1_000_000_000;

        let clock = get_clock(rpc_client).await.unwrap();

        let quote_result = quote_exact_in(
            sol_usdc,
            &lb_pair,
            in_sol_amount,
            true,
            bin_arrays.clone(),
            None,
            clock.unix_timestamp as u64,
            clock.slot,
        )
        .unwrap();

        println!(
            "1 SOL -> {:?} USDC",
            quote_result.amount_out as f64 / 1_000_000.0
        );

        // 100 USDC -> SOL
        let in_usdc_amount = 100_000_000;

        let quote_result = quote_exact_in(
            sol_usdc,
            &lb_pair,
            in_usdc_amount,
            false,
            bin_arrays.clone(),
            None,
            clock.unix_timestamp as u64,
            clock.slot,
        )
        .unwrap();

        println!(
            "100 USDC -> {:?} SOL",
            quote_result.amount_out as f64 / 1_000_000_000.0
        );
    }
