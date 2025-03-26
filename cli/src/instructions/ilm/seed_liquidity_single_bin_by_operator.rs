use anchor_lang::{prelude::Clock, AccountDeserialize};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::spl_token::instruction::transfer_checked,
    token_interface::{Mint, TokenAccount},
};
use spl_associated_token_account::instruction::create_associated_token_account_idempotent;

use crate::*;

#[derive(Debug, Parser)]
pub struct SeedLiquiditySingleBinByOperatorParameters {
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
    /// price
    #[clap(long)]
    pub price: f64,
    /// Position owner
    #[clap(long)]
    pub position_owner: Pubkey,
    /// lock release point
    #[clap(long)]
    pub lock_release_point: u64,
    /// fee owner
    #[clap(long)]
    pub fee_owner: Pubkey,
    /// Selective rounding
    #[clap(long)]
    pub selective_rounding: SelectiveRounding,
}

pub async fn execute_seed_liquidity_single_bin_by_operator<
    C: Deref<Target = impl Signer> + Clone,
>(
    params: SeedLiquiditySingleBinByOperatorParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let SeedLiquiditySingleBinByOperatorParameters {
        lb_pair,
        base_position_path,
        base_pubkey,
        amount,
        price,
        position_owner,
        lock_release_point,
        fee_owner,
        selective_rounding,
    } = params;

    let position_base_kp =
        read_keypair_file(base_position_path).expect("position base keypair file not found");

    assert_eq!(
        position_base_kp.pubkey(),
        base_pubkey,
        "Invalid position base key"
    );

    let rpc_client = program.async_rpc();
    let operator = program.payer();

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let [token_x_owner, token_y_owner] = lb_pair_state.get_token_programs()?;

    let bin_step = lb_pair_state.bin_step;

    let operator_token_x = get_associated_token_address_with_program_id(
        &operator,
        &lb_pair_state.token_x_mint,
        &token_x_owner,
    );

    let operator_token_y = get_associated_token_address_with_program_id(
        &operator,
        &lb_pair_state.token_y_mint,
        &token_y_owner,
    );

    let owner_token_x = get_associated_token_address_with_program_id(
        &position_owner,
        &lb_pair_state.token_x_mint,
        &token_x_owner,
    );

    let (mut bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    let mut accounts = rpc_client
        .get_multiple_accounts(&[
            lb_pair_state.token_x_mint,
            lb_pair_state.token_y_mint,
            owner_token_x,
            bin_array_bitmap_extension,
            solana_sdk::sysvar::clock::ID,
        ])
        .await?;

    let token_mint_base_account = accounts[0].take().context("token_mint_base not found")?;
    let token_mint_quote_account = accounts[1].take().context("token_mint_quote not found")?;
    let owner_token_x_account = accounts[2].take();
    let bin_array_bitmap_extension_account = accounts[3].take();
    let clock_account = accounts[4].take().context("clock not found")?;

    let clock = bincode::deserialize::<Clock>(&clock_account.data)?;

    let token_mint_base = Mint::try_deserialize(&mut token_mint_base_account.data.as_ref())?;
    let token_mint_quote = Mint::try_deserialize(&mut token_mint_quote_account.data.as_ref())?;

    let native_amount = to_wei_amount(amount, token_mint_base.decimals)?;
    let native_amount = calculate_transfer_fee_included_amount(
        &token_mint_base_account,
        native_amount,
        clock.epoch,
    )?
    .amount;

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

    let (event_authority, _bump) = derive_event_authority_pda();
    let (position, _bump) = derive_position_pda(lb_pair, base_pubkey, bin_id, 1);

    let bin_array_accounts_meta =
        BinArray::get_bin_array_account_metas_coverage(bin_id, bin_id, lb_pair)?;

    let bin_array_index = BinArray::bin_id_to_bin_array_index(bin_id)?;

    let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

    if let Some(priority_fee_ix) = compute_unit_price {
        instructions.push(priority_fee_ix);
    }

    let (min_bitmap_id, max_bitmap_id) = LbPair::bitmap_range();
    // We only deposit to lower bin array
    let overflow_internal_bitmap_range =
        bin_array_index > max_bitmap_id || bin_array_index < min_bitmap_id;

    if overflow_internal_bitmap_range && bin_array_bitmap_extension_account.is_none() {
        let accounts: [AccountMeta; INITIALIZE_BIN_ARRAY_BITMAP_EXTENSION_IX_ACCOUNTS_LEN] =
            InitializeBinArrayBitmapExtensionKeys {
                lb_pair,
                bin_array_bitmap_extension,
                funder: program.payer(),
                system_program: solana_sdk::system_program::ID,
                rent: solana_sdk::sysvar::rent::ID,
            }
            .into();

        let data = InitializeBinArrayBitmapExtensionIxData.try_to_vec()?;

        let initialize_bitmap_extension_ix = Instruction {
            accounts: accounts.to_vec(),
            program_id: dlmm_interface::ID,
            data,
        };

        instructions.push(initialize_bitmap_extension_ix);
    } else {
        bin_array_bitmap_extension = dlmm_interface::ID;
    }

    let account: [AccountMeta; INITIALIZE_BIN_ARRAY_IX_ACCOUNTS_LEN] = InitializeBinArrayKeys {
        lb_pair,
        bin_array: bin_array_accounts_meta[0].pubkey,
        funder: program.payer(),
        system_program: solana_sdk::system_program::ID,
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

    let require_token_prove = if let Some(account) = owner_token_x_account {
        let token_account = TokenAccount::try_deserialize(&mut account.data.as_ref())?;
        token_account.amount == 0
    } else {
        true
    };

    if require_token_prove {
        instructions.push(create_associated_token_account_idempotent(
            &operator,
            &position_owner,
            &lb_pair_state.token_x_mint,
            &token_x_owner,
        ));

        let prove_amount =
            calculate_transfer_fee_included_amount(&token_mint_base_account, 1, clock.epoch)?
                .amount;

        instructions.push(transfer_checked(
            &token_x_owner,
            &operator_token_x,
            &lb_pair_state.token_x_mint,
            &owner_token_x,
            &operator,
            &[],
            prove_amount,
            token_mint_base.decimals,
        )?);
    }

    let accounts: [AccountMeta; INITIALIZE_POSITION_BY_OPERATOR_IX_ACCOUNTS_LEN] =
        InitializePositionByOperatorKeys {
            lb_pair,
            base: base_pubkey,
            owner: position_owner,
            operator: program.payer(),
            payer: program.payer(),
            position,
            system_program: solana_sdk::system_program::ID,
            event_authority,
            operator_token_x,
            owner_token_x,
            program: dlmm_interface::ID,
        }
        .into();

    let data = InitializePositionByOperatorIxData(InitializePositionByOperatorIxArgs {
        lower_bin_id: bin_id,
        width: 1,
        fee_owner,
        lock_release_point,
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

    remaining_accounts.extend(bin_array_accounts_meta);

    let main_accounts: [AccountMeta; ADD_LIQUIDITY2_IX_ACCOUNTS_LEN] = AddLiquidity2Keys {
        position,
        lb_pair,
        bin_array_bitmap_extension,
        user_token_x: operator_token_x,
        user_token_y: operator_token_y,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        sender: program.payer(),
        token_x_program: token_mint_base_account.owner,
        token_y_program: token_mint_quote_account.owner,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let data = AddLiquidity2IxData(AddLiquidity2IxArgs {
        liquidity_parameter: LiquidityParameter {
            amount_x: native_amount,
            amount_y: 0,
            bin_liquidity_dist: vec![BinLiquidityDistribution {
                bin_id,
                distribution_x: 10000,
                distribution_y: 10000,
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
