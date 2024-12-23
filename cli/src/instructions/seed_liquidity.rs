use crate::*;
use anchor_lang::system_program;
use anchor_spl::token_2022::spl_token_2022::state::Mint;
use instructions::*;
use serde::{Deserialize, Serialize};
use serde_json_any_key::*;
use solana_sdk::{program_pack::Pack, sysvar};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, BufWriter, Write},
};

#[derive(Serialize, Deserialize, Default)]
pub struct DustDepositState {
    pub lb_pair: Pubkey,
    pub dust_amount: u64,
    #[serde(with = "any_key_map")]
    pub bins_amount_x: HashMap<i32, u64>,
    pub total_amount_in_bins_onchain: u64,
    #[serde(with = "any_key_map")]
    pub position_shares: HashMap<Pubkey, Vec<u128>>,
}

pub fn to_wei_amount(amount: u64, decimal: u8) -> Result<u64> {
    let wei_amount = amount
        .checked_mul(10u64.pow(decimal.into()))
        .context("to_wei_amount overflow")?;

    Ok(wei_amount)
}

pub fn convert_min_max_ui_price_to_min_max_bin_id(
    bin_step: u16,
    min_price: f64,
    max_price: f64,
    base_token_decimal: u8,
    quote_token_decimal: u8,
) -> Result<(i32, i32)> {
    let min_price_per_lamport =
        price_per_token_to_per_lamport(min_price, base_token_decimal, quote_token_decimal)
            .context("price_per_token_to_per_lamport overflow")?;

    let min_active_id = get_id_from_price(bin_step, &min_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let max_price_per_lamport =
        price_per_token_to_per_lamport(max_price, base_token_decimal, quote_token_decimal)
            .context("price_per_token_to_per_lamport overflow")?;

    let max_active_id = get_id_from_price(bin_step, &max_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    Ok((min_active_id, max_active_id))
}

fn get_base(bin_step: u16) -> f64 {
    1.0 + bin_step as f64 / 10_000.0
}

pub fn get_ui_price_from_id(
    bin_step: u16,
    bin_id: i32,
    base_token_decimal: i32,
    quote_token_decimal: i32,
) -> f64 {
    let base = get_base(bin_step);
    base.powi(bin_id) * 10.0f64.powi(base_token_decimal - quote_token_decimal)
}

pub fn get_number_of_position_required_to_cover_range(
    min_bin_id: i32,
    max_bin_id: i32,
) -> Result<i32> {
    let bin_delta = max_bin_id
        .checked_sub(min_bin_id)
        .context("bin_delta overflow")?;
    let mut position_required = bin_delta
        .checked_div(DEFAULT_BIN_PER_POSITION as i32)
        .context("position_required overflow")?;
    let rem = bin_delta % DEFAULT_BIN_PER_POSITION as i32;

    if rem > 0 {
        position_required += 1;
    }

    Ok(position_required)
}

async fn get_or_create_position<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    lb_pair: Pubkey,
    base_keypair: &Keypair,
    lower_bin_id: i32,
    upper_bin_id: i32,
    width: i32,
    owner: &Keypair,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price_ix: Option<Instruction>,
) -> Result<DynamicPosition> {
    let (event_authority, _bump) = derive_event_authority_pda();
    let base = base_keypair.pubkey();

    let rpc_client = program.async_rpc();

    let (position, _bump) = derive_position_pda(lb_pair, base, lower_bin_id, width);

    if rpc_client.get_account_data(&position).await.is_err() {
        let accounts: [AccountMeta; INITIALIZE_POSITION_PDA_IX_ACCOUNTS_LEN] =
            InitializePositionPdaKeys {
                lb_pair,
                base,
                owner: owner.pubkey(),
                payer: program.payer(),
                position,
                rent: sysvar::rent::ID,
                system_program: system_program::ID,
                event_authority,
                program: dlmm_interface::ID,
            }
            .into();

        let data = InitializePositionPdaIxData(InitializePositionPdaIxArgs {
            lower_bin_id,
            width,
        })
        .try_to_vec()?;

        let initialize_position_ix = Instruction {
            program_id: dlmm_interface::ID,
            accounts: accounts.to_vec(),
            data,
        };

        let mut builder = program.request();

        if let Some(compute_unit_price_ix) = compute_unit_price_ix {
            builder = builder.instruction(compute_unit_price_ix);
        }

        builder = builder
            .instruction(initialize_position_ix)
            .signer(base_keypair)
            .signer(owner);
        let signature = builder
            .send_with_spinner_and_config(transaction_config)
            .await;
        println!(
            "Create position: lower bin id {lower_bin_id} upper bin id {upper_bin_id} position {position}. signature {:#?}",
            signature
        );
        signature?;
    }

    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(DynamicPosition::deserialize(&account.data)?)
        })
        .await?;

    Ok(position_state)
}

pub async fn deposit<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    position: Pubkey,
    position_state: &DynamicPosition,
    lb_pair_state: &LbPair,
    user_token_x: Pubkey,
    user_token_y: Pubkey,
    deposit_amount_x: u64,
    position_liquidity_distribution: Vec<BinLiquidityDistribution>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price_ix: Option<Instruction>,
) -> Result<String> {
    let (event_authority, _bump) = derive_event_authority_pda();
    let mut instructions = if let Some(compute_unit_price_ix) = compute_unit_price_ix {
        vec![
            compute_unit_price_ix,
            ComputeBudgetInstruction::set_compute_unit_limit(800_000),
        ]
    } else {
        vec![ComputeBudgetInstruction::set_compute_unit_limit(800_000)]
    };

    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let bin_array_accounts_meta = position_state
        .global_data
        .get_bin_array_accounts_meta_coverage()?;

    let main_accounts: [AccountMeta; ADD_LIQUIDITY2_IX_ACCOUNTS_LEN] = AddLiquidity2Keys {
        lb_pair: position_state.global_data.lb_pair,
        position,
        sender: program.payer(),
        event_authority,
        program: dlmm_interface::ID,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        user_token_x,
        user_token_y,
        token_x_program,
        token_y_program,
        memo_program: spl_memo::ID,
        bin_array_bitmap_extension: dlmm_interface::ID,
    }
    .into();

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut remaining_accounts = vec![];

    if let Some((slices, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            lb_pair_state,
            program.async_rpc(),
            ActionType::LiquidityProvision,
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        remaining_accounts.extend(transfer_hook_remaining_accounts);
    }

    remaining_accounts.extend(bin_array_accounts_meta);

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let data = AddLiquidityIxData(AddLiquidityIxArgs {
        liquidity_parameter: LiquidityParameter {
            amount_x: deposit_amount_x,
            amount_y: deposit_amount_x,
            bin_liquidity_dist: position_liquidity_distribution,
        },
    })
    .try_to_vec()?;

    let deposit_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    instructions.push(deposit_ix);

    let builder = program.request();
    let builder = instructions
        .into_iter()
        .fold(builder, |bld, ix| bld.instruction(ix));

    let signature = builder
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Seed liquidity min_bin_id {} max_bin_id {} Position {position}. Sig: {:#?}",
        position_state.global_data.lower_bin_id, position_state.global_data.upper_bin_id, signature
    );

    Ok(signature?.to_string())
}

pub async fn create_position_bin_array_if_not_exists<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    lb_pair: Pubkey,
    lower_bin_id: i32,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price_ix: Option<Instruction>,
) -> Result<(i32, i32)> {
    let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
    let upper_bin_array_idx = lower_bin_array_idx + 1;

    let rpc_client = program.async_rpc();

    let mut create_bin_array_ixs = vec![];

    for idx in lower_bin_array_idx..=upper_bin_array_idx {
        // Initialize bin array if not exists
        let (bin_array, _bump) = derive_bin_array_pda(lb_pair, idx.into());

        if rpc_client.get_account_data(&bin_array).await.is_err() {
            let accounts: [AccountMeta; INITIALIZE_BIN_ARRAY_IX_ACCOUNTS_LEN] =
                InitializeBinArrayKeys {
                    bin_array,
                    funder: program.payer(),
                    lb_pair,
                    system_program: system_program::ID,
                }
                .into();

            let data = InitializeBinArrayIxData(InitializeBinArrayIxArgs { index: idx.into() })
                .try_to_vec()?;

            let create_bin_array_ix = Instruction {
                program_id: dlmm_interface::ID,
                accounts: accounts.to_vec(),
                data,
            };

            if create_bin_array_ixs.is_empty() {
                create_bin_array_ixs
                    .push(ComputeBudgetInstruction::set_compute_unit_limit(400_000));
                if let Some(compute_unit_price_ix) = compute_unit_price_ix.clone() {
                    create_bin_array_ixs.push(compute_unit_price_ix);
                }
            }
            create_bin_array_ixs.push(create_bin_array_ix);
        }
    }

    let ixs_length = create_bin_array_ixs.len();

    if !create_bin_array_ixs.is_empty() {
        let mut request_builder = program.request();

        for ix in create_bin_array_ixs {
            request_builder = request_builder.instruction(ix);
        }

        let sig = request_builder
            .send_with_spinner_and_config(transaction_config)
            .await;
        println!("Initialize {} bin arrays. Signature {:#?}", ixs_length, sig);

        sig?;
    }

    Ok((lower_bin_array_idx, upper_bin_array_idx))
}

pub fn deposit_amount_to_deposit_parameter(
    bins_amount: &HashMap<i32, u64>,
    lower_bin_id: i32,
    upper_bin_id: i32,
) -> Result<(Vec<BinLiquidityDistribution>, u64)> {
    let mut total_amount = 0;

    for bin_id in lower_bin_id..=upper_bin_id {
        let amount = bins_amount
            .get(&bin_id)
            .context(format!("Bin amount not found for bin id {}", bin_id))?;

        total_amount += amount;
    }

    let mut bin_liquidity_dist = vec![];

    for bin_id in lower_bin_id..=upper_bin_id {
        let amount = bins_amount
            .get(&bin_id)
            .context(format!("Bin amount not found for bin id {}", bin_id))
            .cloned()?;

        let distribution_x = u128::from(amount)
            .checked_mul(BASIS_POINT_MAX as u128)
            .context("distribution_x overflow")?
            .checked_div(total_amount.into())
            .context("distribution_x overflow")?
            .try_into()
            .context("distribution_x overflow")?;

        let dist = BinLiquidityDistribution {
            bin_id,
            distribution_x,
            distribution_y: 0,
        };

        bin_liquidity_dist.push(dist);
    }

    Ok((bin_liquidity_dist, total_amount))
}

pub async fn get_on_chain_bins_amount_x<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    min_bin_id: i32,
    max_bin_id: i32,
    program: &Program<C>,
) -> Result<(HashMap<i32, u64>, u64)> {
    let rpc_client = program.async_rpc();
    let start_bin_array_index = BinArray::bin_id_to_bin_array_index(min_bin_id)?;
    let end_bin_array_index = BinArray::bin_id_to_bin_array_index(max_bin_id)?;

    let mut bins_amount_x = HashMap::new();
    let mut total_amount_x = 0;

    for bin_array_idx in start_bin_array_index..=end_bin_array_index {
        let (bin_array_pubkey, _bump) = derive_bin_array_pda(lb_pair, bin_array_idx.into());

        let bin_array = rpc_client
            .get_account_and_deserialize(&bin_array_pubkey, |account| {
                Ok(BinArrayAccount::deserialize(&account.data)?.0)
            })
            .await?;

        let (mut lower_bin_id, _) = BinArray::get_bin_array_lower_upper_bin_id(bin_array_idx)?;

        for bin in bin_array.bins {
            if bin.amount_x > 0 {
                bins_amount_x.insert(lower_bin_id, bin.amount_x);
                total_amount_x += bin.amount_x;
            }
            lower_bin_id += 1;
        }
    }

    Ok((bins_amount_x, total_amount_x))
}

pub fn generate_redistribute_amount_to_position_based_on_ratio(
    on_chain_bins_amount_x: &HashMap<i32, u64>,
    on_chain_total_amount_x: u128,
    leftover_amount: u128,
    lower_bin_id: i32,
    upper_bin_id: i32,
) -> Result<(Vec<BinLiquidityDistribution>, u64)> {
    let mut position_redistributed_amount_x = HashMap::new();

    for bin_id in lower_bin_id..=upper_bin_id {
        let bin_amount_x: u128 = (*on_chain_bins_amount_x
            .get(&bin_id)
            .context("on chain bin amount x not found")?)
        .into();

        let redistribute_amount: u64 = leftover_amount
            .checked_mul(bin_amount_x)
            .context("redistribute_amount overflow")?
            .checked_div(on_chain_total_amount_x)
            .context("redistribute_amount overflow")?
            .try_into()
            .context("redistribute_amount overflow")?;

        position_redistributed_amount_x.insert(bin_id, redistribute_amount);
    }

    let (position_bin_liquidity_dist, position_redistributed_amount) =
        deposit_amount_to_deposit_parameter(
            &position_redistributed_amount_x,
            lower_bin_id,
            upper_bin_id,
        )?;

    Ok((position_bin_liquidity_dist, position_redistributed_amount))
}

pub fn read_dust_deposit_state(path: &str) -> Result<DustDepositState> {
    let file = File::open(path);
    match file {
        std::io::Result::Ok(file) => {
            let reader = BufReader::new(file);
            let dust_deposit_state = serde_json::from_reader(reader)?;
            Ok(dust_deposit_state)
        }
        std::io::Result::Err(_) => Ok(DustDepositState::default()),
    }
}

pub fn write_dust_deposit_state(path: &str, dust_deposit_state: &DustDepositState) -> Result<()> {
    let file = File::create(path)?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, dust_deposit_state)?;
    writer.flush()?;
    Ok(())
}

#[derive(Debug)]
pub struct SeedLiquidityParameters {
    pub lb_pair: Pubkey,
    pub position_base_kp: Keypair,
    pub amount: u64,
    pub min_price: f64,
    pub max_price: f64,
    pub base_pubkey: Pubkey,
    pub position_owner_kp: Keypair,
    pub curvature: f64,
}

pub async fn execute_seed_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: SeedLiquidityParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let SeedLiquidityParameters {
        lb_pair,
        position_base_kp,
        amount,
        min_price,
        max_price,
        position_owner_kp,
        base_pubkey,
        curvature,
    } = params;

    let rpc_client = program.async_rpc();

    let progress_file_path = format!("{}_progress.json", lb_pair);

    let mut dust_deposit_state = read_dust_deposit_state(&progress_file_path)?;
    if dust_deposit_state.lb_pair != Pubkey::default() {
        assert_eq!(
            dust_deposit_state.lb_pair, lb_pair,
            "Invalid dust deposit tracking file"
        );
    }

    let k = 1.0 / curvature;

    // For easier validation during jup launch through .env
    assert_eq!(
        position_base_kp.pubkey(),
        base_pubkey,
        "Invalid position base key"
    );

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let bin_step = lb_pair_state.bin_step;

    let mut accounts = rpc_client
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?;

    let token_mint_base_account = accounts[0].take().context("token_mint_base not found")?;
    let token_mint_quote_account = accounts[1].take().context("token_mint_quote not found")?;

    let token_mint_base = Mint::unpack(&token_mint_base_account.data)?;
    let token_mint_quote = Mint::unpack(&token_mint_quote_account.data)?;

    let fund_amount = to_wei_amount(amount, token_mint_base.decimals)?;

    let (min_bin_id, max_bin_id) = convert_min_max_ui_price_to_min_max_bin_id(
        bin_step,
        min_price,
        max_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )?;

    let actual_min_price = get_ui_price_from_id(
        bin_step,
        min_bin_id,
        token_mint_base.decimals.into(),
        token_mint_quote.decimals.into(),
    );
    let actual_max_price = get_ui_price_from_id(
        bin_step,
        max_bin_id,
        token_mint_base.decimals.into(),
        token_mint_quote.decimals.into(),
    );

    let position_number = get_number_of_position_required_to_cover_range(min_bin_id, max_bin_id)?;

    println!("Start seed. Min price: {} Max price: {} Actual min price: {} Actual max price: {} Min bin id: {} Max bin id: {} Position: {}", min_price, max_price, actual_min_price, actual_max_price, min_bin_id, max_bin_id, position_number);

    assert!(min_bin_id < max_bin_id, "Invalid price range");

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
    )
    .await?;

    let bins_amount = generate_amount_for_bins(
        bin_step,
        min_bin_id,
        max_bin_id,
        actual_min_price,
        actual_max_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
        fund_amount,
        k,
    );

    let bins_amount_map: HashMap<i32, u64> = bins_amount
        .iter()
        .map(|(bin_id, amount_x)| (*bin_id, *amount_x))
        .collect();

    let width = DEFAULT_BIN_PER_POSITION as i32;

    for i in 0..position_number {
        let lower_bin_id = min_bin_id + (DEFAULT_BIN_PER_POSITION as i32 * i);
        let upper_bin_id = lower_bin_id + DEFAULT_BIN_PER_POSITION as i32 - 1;

        create_position_bin_array_if_not_exists(
            program,
            lb_pair,
            lower_bin_id,
            transaction_config,
            compute_unit_price.clone(),
        )
        .await?;

        let (position, _bump) =
            derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

        let position_state = get_or_create_position(
            program,
            lb_pair,
            &position_base_kp,
            lower_bin_id,
            upper_bin_id,
            width,
            &position_owner_kp,
            transaction_config,
            compute_unit_price.clone(),
        )
        .await?;

        // Position filled
        if !position_state.is_empty() {
            continue;
        }

        assert_eq!(
            position_state.global_data.lower_bin_id, lower_bin_id,
            "Position lower bin id not equals"
        );
        assert_eq!(
            position_state.global_data.upper_bin_id, upper_bin_id,
            "Position upper bin id not equals"
        );

        // Don't deposit to the last bin because c(last_bin + 1) - c(last_bin) will > amount
        let upper_bin_id = std::cmp::min(upper_bin_id, max_bin_id - 1);

        assert!(
            upper_bin_id < max_bin_id,
            "Position upper bin id causes deposit > fund amount"
        );

        let (position_liquidity_distribution, deposit_amount_x) =
            deposit_amount_to_deposit_parameter(&bins_amount_map, lower_bin_id, upper_bin_id)?;

        deposit(
            program,
            position,
            &position_state,
            &lb_pair_state,
            user_token_x,
            user_token_y,
            deposit_amount_x,
            position_liquidity_distribution,
            transaction_config,
            compute_unit_price.clone(),
        )
        .await?;
    }

    // States after principal deposit
    let (leftover, bins_amount_x, total_amount_in_bins_onchain, position_share) =
        if dust_deposit_state.lb_pair.eq(&Pubkey::default()) {
            dust_deposit_state.lb_pair = lb_pair;
            let (bins_amount_x, total_amount_in_bins_onchain) =
                get_on_chain_bins_amount_x(lb_pair, min_bin_id, max_bin_id, program).await?;

            let leftover = fund_amount
                .checked_sub(total_amount_in_bins_onchain)
                .context("leftover overflow")?;

            dust_deposit_state.bins_amount_x = bins_amount_x.clone();
            dust_deposit_state.total_amount_in_bins_onchain = total_amount_in_bins_onchain;
            dust_deposit_state.dust_amount = leftover;

            for i in 0..position_number {
                let lower_bin_id = min_bin_id + (DEFAULT_BIN_PER_POSITION as i32 * i);

                let (position, _bump) =
                    derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

                let position_state = rpc_client
                    .get_account_and_deserialize(&position, |account| {
                        Ok(DynamicPosition::deserialize(&account.data)?)
                    })
                    .await?;

                let position_liquidity_shares = position_state
                    .position_bin_data
                    .iter()
                    .map(|position_bin_data| position_bin_data.liquidity_share)
                    .collect();
                dust_deposit_state
                    .position_shares
                    .insert(position, position_liquidity_shares);
            }

            write_dust_deposit_state(&progress_file_path, &dust_deposit_state)?;

            (
                leftover,
                bins_amount_x,
                total_amount_in_bins_onchain,
                dust_deposit_state.position_shares.clone(),
            )
        } else {
            (
                dust_deposit_state.dust_amount,
                dust_deposit_state.bins_amount_x.clone(),
                dust_deposit_state.total_amount_in_bins_onchain,
                dust_deposit_state.position_shares.clone(),
            )
        };

    // Redistribute leftover amount a.k.a precision loss back into bins based on bin amount with fund amount ratio
    if leftover > 0 {
        println!(
            "=============== Redistribute leftover amount {} ===============",
            leftover
        );

        for i in 0..position_number {
            let lower_bin_id = min_bin_id + (DEFAULT_BIN_PER_POSITION as i32 * i);

            let (position, _bump) =
                derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

            let position_state = rpc_client
                .get_account_and_deserialize(&position, |account| {
                    Ok(DynamicPosition::deserialize(&account.data)?)
                })
                .await?;

            let position_share_snapshot =
                position_share.get(&position).context("Missing snapshot")?;

            let mut dust_deposited = false;
            for (i, share) in position_state
                .position_bin_data
                .iter()
                .map(|position_bin_data| position_bin_data.liquidity_share)
                .enumerate()
            {
                let snapshot_share = position_share_snapshot[i];
                if snapshot_share != share {
                    dust_deposited = true;
                    break;
                }
            }

            if dust_deposited {
                continue;
            }

            // Don't deposit to the last bin because c(last_bin + 1) - c(last_bin) will > amount
            let upper_bin_id =
                std::cmp::min(position_state.global_data.upper_bin_id, max_bin_id - 1);

            assert!(
                upper_bin_id < max_bin_id,
                "Position upper bin id causes deposit > fund amount"
            );

            let (position_liquidity_distribution, position_redistributed_amount) =
                generate_redistribute_amount_to_position_based_on_ratio(
                    &bins_amount_x,
                    total_amount_in_bins_onchain.into(),
                    leftover.into(),
                    lower_bin_id,
                    upper_bin_id,
                )?;

            deposit(
                program,
                position,
                &position_state,
                &lb_pair_state,
                user_token_x,
                user_token_y,
                position_redistributed_amount,
                position_liquidity_distribution,
                transaction_config,
                compute_unit_price.clone(),
            )
            .await?;
        }
    }

    let (_, total_amount_in_bin_onchain) =
        get_on_chain_bins_amount_x(lb_pair, min_bin_id, max_bin_id, program).await?;

    let leftover = fund_amount
        .checked_sub(total_amount_in_bin_onchain)
        .context("leftover overflow")?;

    // Shall be dust after redistribute
    if leftover > 0 {
        println!("Deposit dust {} to last semi bin", leftover);
        let lower_bin_id = min_bin_id + (DEFAULT_BIN_PER_POSITION as i32 * (position_number - 1));

        let (position, _bump) =
            derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

        let position_state = rpc_client
            .get_account_and_deserialize(&position, |account| {
                Ok(DynamicPosition::deserialize(&account.data)?)
            })
            .await?;

        // Don't deposit to the last bin because c(last_bin + 1) - c(last_bin) will > amount
        let upper_bin_id = std::cmp::min(position_state.global_data.upper_bin_id, max_bin_id - 1);

        assert!(upper_bin_id < max_bin_id, "Funding to last bin id");

        deposit(
            program,
            position,
            &position_state,
            &lb_pair_state,
            user_token_x,
            user_token_y,
            leftover,
            vec![BinLiquidityDistribution {
                bin_id: upper_bin_id,
                distribution_x: 10000,
                distribution_y: 0,
            }],
            transaction_config,
            compute_unit_price,
        )
        .await?;
    }

    let (bins_amount_x, total_amount_in_bins_onchain) =
        get_on_chain_bins_amount_x(lb_pair, min_bin_id, max_bin_id, program).await?;

    let leftover = fund_amount
        .checked_sub(total_amount_in_bins_onchain)
        .context("leftover overflow")?;

    assert_eq!(leftover, 0, "Still have leftover");

    let mut bin_amount_sorted_by_id = bins_amount_x
        .iter()
        .map(|(bin_id, amount)| (*bin_id, *amount))
        .collect::<Vec<(i32, u64)>>();

    bin_amount_sorted_by_id.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    Ok(())
}

fn get_bin_deposit_amount(
    amount: u64,
    bin_step: u16,
    bin_id: i32,
    base_token_decimal: u8,
    quote_token_decimal: u8,
    min_price: f64,
    max_price: f64,
    k: f64,
) -> u64 {
    let c1 = get_c(
        amount,
        bin_step,
        bin_id + 1,
        base_token_decimal,
        quote_token_decimal,
        min_price,
        max_price,
        k,
    );

    let c0 = get_c(
        amount,
        bin_step,
        bin_id,
        base_token_decimal,
        quote_token_decimal,
        min_price,
        max_price,
        k,
    );

    assert!(c1 > c0);

    let amount_into_bin = c1 - c0;
    amount_into_bin
}

// c(p) = 5 * 10^8 ((p - 0.1)/0.7) ^ 1.25, where P = ui price
// c(p) = 5 * 10^8 ((p - min_price)/(max_price - min_price)) ^ 1.25
fn get_c(
    amount: u64,
    bin_step: u16,
    bin_id: i32,
    base_token_decimal: u8,
    quote_token_decimal: u8,
    min_price: f64,
    max_price: f64,
    k: f64,
) -> u64 {
    let price_per_lamport = (1.0 + bin_step as f64 / 10000.0).powi(bin_id);

    let current_price =
        price_per_lamport * 10.0f64.powi(base_token_decimal as i32 - quote_token_decimal as i32);

    let price_range = max_price - min_price;
    let current_price_delta_from_min = current_price - min_price;

    let c = amount as f64 * ((current_price_delta_from_min / price_range).powf(k));
    c as u64
}

pub fn generate_amount_for_bins(
    bin_step: u16,
    min_bin_id: i32,
    max_bin_id: i32,
    min_price: f64,
    max_price: f64,
    base_token_decimal: u8,
    quote_token_decimal: u8,
    amount: u64,
    k: f64,
) -> Vec<(i32, u64)> {
    let mut total_amount = 0;
    let mut bin_amounts = vec![];

    // Last bin is purposely no included because for the last bin, c(last_bin +1) - c(last_bin) will > fund amount
    for bin_id in min_bin_id..max_bin_id {
        let bin_amount = get_bin_deposit_amount(
            amount,
            bin_step,
            bin_id,
            base_token_decimal,
            quote_token_decimal,
            min_price,
            max_price,
            k,
        );

        bin_amounts.push((bin_id, bin_amount));

        total_amount += bin_amount;
    }

    assert_eq!(
        total_amount, amount,
        "Amount distributed to bins not equals to funding amount"
    );

    bin_amounts
}
