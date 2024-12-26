use crate::*;
use anchor_lang::system_program;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;
use instructions::*;
use seed_liquidity::to_wei_amount;
use solana_sdk::sysvar;

#[derive(Debug, Parser)]
pub struct SeedLiquiditySingleBinParameters {
    /// Address of the pair
    #[clap(long)]
    pub lb_pair: Pubkey,
    /// Base position path
    #[clap(long)]
    pub base_position_path: String,
    /// Base position pubkey
    #[clap(long)]
    pub base_pubkey: Pubkey,
    /// amount of x
    #[clap(long)]
    pub amount: u64,
    #[clap(long)]
    pub price: f64,
    /// Position owner
    #[clap(long)]
    pub position_owner_path: String,
    /// Selective rounding
    #[clap(long)]
    pub selective_rounding: SelectiveRounding,
}

pub async fn execute_seed_liquidity_single_bin<C: Deref<Target = impl Signer> + Clone>(
    params: SeedLiquiditySingleBinParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let SeedLiquiditySingleBinParameters {
        lb_pair,
        amount,
        price,
        base_pubkey,
        selective_rounding,
        base_position_path,
        position_owner_path,
    } = params;

    let position_base_kp =
        read_keypair_file(base_position_path).expect("position base keypair file not found");

    let position_owner_kp =
        read_keypair_file(position_owner_path).expect("position owner keypair file not found");

    assert_eq!(
        position_base_kp.pubkey(),
        base_pubkey,
        "Invalid position base key"
    );

    let rpc_client = program.async_rpc();

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let bin_step = lb_pair_state.bin_step;
    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let mut accounts = rpc_client
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?;

    let token_mint_base_account = accounts[0].take().context("token_mint_base not found")?;
    let token_mint_quote_account = accounts[1].take().context("token_mint_quote not found")?;

    let token_mint_base = Mint::try_deserialize(&mut token_mint_base_account.data.as_ref())?;
    let token_mint_quote = Mint::try_deserialize(&mut token_mint_quote_account.data.as_ref())?;

    let native_amount = to_wei_amount(amount, token_mint_base.decimals)?;

    let price =
        price_per_token_to_per_lamport(price, token_mint_base.decimals, token_mint_quote.decimals)
            .context("price_per_token_per_lamport overflow")?;

    let bin_id = match selective_rounding {
        SelectiveRounding::None => get_precise_id_from_price(bin_step, &price)
            .context("fail to get exact bin id for the price"),
        SelectiveRounding::Down => get_id_from_price(bin_step, &price, Rounding::Down)
            .context("get_id_from_price overflow"),
        SelectiveRounding::Up => {
            get_id_from_price(bin_step, &price, Rounding::Up).context("get_id_from_price overflow")
        }
    }?;

    assert_eq!(
        lb_pair_state.active_id, bin_id,
        "bin id doesn't match active bin id"
    );

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let (event_authority, _bump) = derive_event_authority_pda();
    let (position, _bump) = derive_position_pda(lb_pair, base_pubkey, bin_id, 1);

    let lower_bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id)?;
    let upper_bin_array_index = lower_bin_array_index + 1;

    let (lower_bin_array, _bump) = derive_bin_array_pda(lb_pair, lower_bin_array_index.into());
    let (upper_bin_array, _bump) = derive_bin_array_pda(lb_pair, upper_bin_array_index.into());

    let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

    if let Some(priority_fee_ix) = compute_unit_price {
        instructions.push(priority_fee_ix);
    }

    let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
    // We only deposit to lower bin array
    let overflow_internal_bitmap_range =
        lower_bin_array_index > max_bitmap_id || lower_bin_array_index < min_bitmap_id;
    let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    if overflow_internal_bitmap_range {
        let bitmap_extension_account = rpc_client.get_account(&bin_array_bitmap_extension).await;
        if bitmap_extension_account.is_err() {
            let accounts: [AccountMeta; INITIALIZE_BIN_ARRAY_BITMAP_EXTENSION_IX_ACCOUNTS_LEN] =
                InitializeBinArrayBitmapExtensionKeys {
                    lb_pair,
                    bin_array_bitmap_extension,
                    funder: program.payer(),
                    system_program: system_program::ID,
                    rent: sysvar::rent::ID,
                }
                .into();

            let data = InitializeBinArrayBitmapExtensionIxData.try_to_vec()?;

            let initialize_bitmap_extension_ix = Instruction {
                accounts: accounts.to_vec(),
                program_id: dlmm_interface::ID,
                data,
            };

            instructions.push(initialize_bitmap_extension_ix);
        }
    }

    let bin_array_bitmap_extension = if overflow_internal_bitmap_range {
        bin_array_bitmap_extension
    } else {
        dlmm_interface::ID
    };

    for (bin_array, bin_array_index) in [
        (lower_bin_array, lower_bin_array_index),
        (upper_bin_array, upper_bin_array_index),
    ] {
        if rpc_client.get_account(&lower_bin_array).await.is_err() {
            let account: [AccountMeta; INITIALIZE_BIN_ARRAY_IX_ACCOUNTS_LEN] =
                InitializeBinArrayKeys {
                    lb_pair,
                    bin_array,
                    funder: program.payer(),
                    system_program: system_program::ID,
                }
                .into();

            let data = InitializeBinArrayIxData(InitializeBinArrayIxArgs {
                index: bin_array_index.into(),
            })
            .try_to_vec()?;

            let initialize_bin_array_ix = Instruction {
                accounts: account.to_vec(),
                program_id: dlmm_interface::ID,
                data,
            };

            instructions.push(initialize_bin_array_ix);
        }
    }

    let accounts: [AccountMeta; INITIALIZE_POSITION_PDA_IX_ACCOUNTS_LEN] =
        InitializePositionPdaKeys {
            position,
            base: base_pubkey,
            payer: program.payer(),
            owner: position_owner_kp.pubkey(),
            lb_pair,
            system_program: system_program::ID,
            rent: sysvar::rent::ID,
            program: dlmm_interface::ID,
            event_authority,
        }
        .into();

    let data = InitializePositionPdaIxData(InitializePositionPdaIxArgs {
        lower_bin_id: bin_id,
        width: 1,
    })
    .try_to_vec()?;

    let initialize_position_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    instructions.push(initialize_position_ix);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut remaining_accounts = vec![];

    if let Some((slice, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.async_rpc(),
            ActionType::Liquidity,
        )
        .await?
    {
        remaining_accounts_info.slices = slice;
        remaining_accounts.extend(transfer_hook_remaining_accounts);
    }

    remaining_accounts.extend(
        [lower_bin_array, upper_bin_array]
            .into_iter()
            .map(|key| AccountMeta::new(key, false)),
    );

    let main_accounts: [AccountMeta; ADD_LIQUIDITY2_IX_ACCOUNTS_LEN] = AddLiquidity2Keys {
        position,
        lb_pair,
        bin_array_bitmap_extension,
        user_token_x,
        user_token_y,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        sender: program.payer(),
        token_x_program,
        token_y_program,
        event_authority,
        program: dlmm_interface::ID,
        memo_program: spl_memo::ID,
    }
    .into();

    let data = AddLiquidity2IxData(AddLiquidity2IxArgs {
        liquidity_parameter: LiquidityParameter {
            amount_x: native_amount,
            amount_y: 0,
            bin_liquidity_dist: vec![BinLiquidityDistribution {
                bin_id,
                distribution_x: 10000,
                distribution_y: 0,
            }],
        },
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let deposit_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    instructions.push(deposit_ix);

    let mut builder = program.request();
    builder = builder.signer(&position_base_kp);
    builder = instructions
        .into_iter()
        .fold(builder, |builder, ix| builder.instruction(ix));

    let signature = builder
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("{:#?}", signature);

    signature?;

    Ok(())
}
