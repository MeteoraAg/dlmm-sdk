use std::collections::HashMap;
use std::ops::Deref;

use crate::instructions::seed_liquidity::{
    convert_min_max_ui_price_to_min_max_bin_id, create_position_bin_array_if_not_exists, deposit,
    deposit_amount_to_deposit_parameter, generate_amount_for_bins,
    generate_redistribute_amount_to_position_based_on_ratio,
    get_number_of_position_required_to_cover_range, get_on_chain_bins_amount_x,
    get_ui_price_from_id, read_dust_deposit_state, to_wei_amount, write_dust_deposit_state,
};
use crate::instructions::utils::get_or_create_ata;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::solana_sdk::signature::Keypair;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::token::{spl_token, Mint};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::constants::MAX_BIN_PER_POSITION;
use lb_clmm::instruction;
use lb_clmm::instructions::deposit::BinLiquidityDistribution;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda::*;
use spl_associated_token_account::get_associated_token_address;
use spl_associated_token_account::instruction::create_associated_token_account;

async fn get_or_create_position<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    lb_pair: Pubkey,
    base_keypair: &Keypair,
    lower_bin_id: i32,
    upper_bin_id: i32,
    width: i32,
    owner: Pubkey,
    fee_owner: Pubkey,
    lock_release_point: u64,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price_ix: Option<Instruction>,
) -> Result<PositionV2> {
    let (event_authority, _bump) = derive_event_authority_pda();
    let base = base_keypair.pubkey();

    let (position, _bump) = derive_position_pda(lb_pair, base, lower_bin_id, width);

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    if program.rpc().get_account_data(&position).is_err() {
        let mut builder = program.request();

        let operator_token_x =
            get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint);
        let owner_token_x = get_associated_token_address(&owner, &lb_pair_state.token_x_mint);

        match program.rpc().get_account(&owner_token_x) {
            std::result::Result::Ok(value) => {
                let bytes = value.data;
                let mut amount_bytes = [0u8; 8];
                amount_bytes.copy_from_slice(&bytes[64..72]);
                let amount = u64::from_le_bytes(amount_bytes);
                if amount == 0 {
                    builder = builder.instruction(spl_token::instruction::transfer(
                        &spl_token::ID,
                        &operator_token_x,
                        &owner_token_x,
                        &program.payer(),
                        &[],
                        1, // send 1 lamport to prove ownership
                    )?);
                }
            }
            Err(_) => {
                builder = builder
                    .instruction(create_associated_token_account(
                        &program.payer(),
                        &owner,
                        &lb_pair_state.token_x_mint,
                        &spl_token::ID,
                    ))
                    .instruction(spl_token::instruction::transfer(
                        &spl_token::ID,
                        &operator_token_x,
                        &owner_token_x,
                        &program.payer(),
                        &[],
                        1, // send 1 lamport to prove ownership
                    )?);
            }
        }

        let ix: Instruction = Instruction {
            program_id: lb_clmm::ID,
            accounts: accounts::InitializePositionByOperator {
                lb_pair,
                base,
                owner,
                operator: program.payer(),
                payer: program.payer(),
                position,
                system_program: anchor_client::solana_sdk::system_program::ID,
                event_authority,
                operator_token_x,
                owner_token_x,
                program: lb_clmm::ID,
            }
            .to_account_metas(None),
            data: instruction::InitializePositionByOperator {
                lower_bin_id,
                width,
                fee_owner,
                lock_release_point,
            }
            .data(),
        };

        if let Some(compute_unit_price_ix) = compute_unit_price_ix {
            builder = builder.instruction(compute_unit_price_ix);
        }

        builder = builder.instruction(ix).signer(base_keypair);
        let signature = builder
            .send_with_spinner_and_config(transaction_config)
            .await;
        println!(
            "Create position: lower bin id {lower_bin_id} upper bin id {upper_bin_id} position {position}. signature {:#?}",
            signature
        );
        signature?;
    }

    let position_state: PositionV2 = program.account(position).await?;

    Ok(position_state)
}

#[derive(Debug)]
pub struct SeedLiquidityByOperatorParameters {
    pub lb_pair: Pubkey,
    pub position_base_kp: Keypair,
    pub amount: u64,
    pub min_price: f64,
    pub max_price: f64,
    pub base_pubkey: Pubkey,
    pub position_owner: Pubkey,
    pub fee_owner: Pubkey,
    pub lock_release_point: u64,
    pub curvature: f64,
}

pub async fn seed_liquidity_by_operator<C: Deref<Target = impl Signer> + Clone>(
    params: SeedLiquidityByOperatorParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let SeedLiquidityByOperatorParameters {
        lb_pair,
        position_base_kp,
        amount,
        min_price,
        max_price,
        position_owner,
        fee_owner,
        lock_release_point,
        base_pubkey,
        curvature,
    } = params;

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

    let lb_pair_state: LbPair = program.account(lb_pair).await?;
    let bin_step = lb_pair_state.bin_step;

    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint).await?;

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

    let width = MAX_BIN_PER_POSITION as i32;

    for i in 0..position_number {
        let lower_bin_id = min_bin_id + (MAX_BIN_PER_POSITION as i32 * i);
        let upper_bin_id = lower_bin_id + MAX_BIN_PER_POSITION as i32 - 1;

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
            position_owner,
            fee_owner,
            lock_release_point,
            transaction_config,
            compute_unit_price.clone(),
        )
        .await?;

        // Position filled
        if !position_state.is_empty() {
            continue;
        }

        assert_eq!(
            position_state.lower_bin_id, lower_bin_id,
            "Position lower bin id not equals"
        );
        assert_eq!(
            position_state.upper_bin_id, upper_bin_id,
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
                let lower_bin_id = min_bin_id + (MAX_BIN_PER_POSITION as i32 * i);

                let (position, _bump) =
                    derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

                let position_state = program.account::<PositionV2>(position).await?;
                let position_liquidity_shares = position_state.liquidity_shares.to_vec();
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
            let lower_bin_id = min_bin_id + (MAX_BIN_PER_POSITION as i32 * i);

            let (position, _bump) =
                derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

            let position_state: PositionV2 = program.account(position).await?;

            let position_share_snapshot =
                position_share.get(&position).context("Missing snapshot")?;

            let mut dust_deposited = false;
            for (i, share) in position_state.liquidity_shares.iter().enumerate() {
                let snapshot_share = position_share_snapshot[i];
                if snapshot_share != *share {
                    dust_deposited = true;
                    break;
                }
            }

            if dust_deposited {
                continue;
            }

            // Don't deposit to the last bin because c(last_bin + 1) - c(last_bin) will > amount
            let upper_bin_id = std::cmp::min(position_state.upper_bin_id, max_bin_id - 1);

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
        let lower_bin_id = min_bin_id + (MAX_BIN_PER_POSITION as i32 * (position_number - 1));

        let (position, _bump) =
            derive_position_pda(lb_pair, position_base_kp.pubkey(), lower_bin_id, width);

        let position_state: PositionV2 = program.account(position).await?;
        // Don't deposit to the last bin because c(last_bin + 1) - c(last_bin) will > amount
        let upper_bin_id = std::cmp::min(position_state.upper_bin_id, max_bin_id - 1);

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
