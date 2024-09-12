use crate::instructions::utils::{
    get_bin_array_account_meta_by_bin_range, get_extra_account_metas_for_transfer_hook,
    get_or_create_ata,
};
use crate::math::{get_id_from_price, price_per_token_to_per_lamport};
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use anchor_spl::memo;
use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::constants::MAX_BIN_PER_POSITION;
use lb_clmm::instruction;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::pda::*;
use lb_clmm::utils::remaining_accounts_util::{
    AccountsType, RemainingAccountsInfo, RemainingAccountsSlice,
};
use std::ops::Deref;
use std::result::Result::Ok;

#[derive(Debug)]
pub struct RemoveLiquidityByPriceRangeParameters {
    pub lb_pair: Pubkey,
    pub base_position_key: Pubkey,
    pub min_price: f64,
    pub max_price: f64,
}

pub async fn remove_liquidity_by_price_range<C: Deref<Target = impl Signer> + Clone>(
    params: RemoveLiquidityByPriceRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let RemoveLiquidityByPriceRangeParameters {
        lb_pair,
        base_position_key,
        min_price,
        max_price,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;
    let bin_step = lb_pair_state.bin_step;

    let token_mint_base: Mint = program.account(lb_pair_state.token_x_mint).await?;
    let token_mint_quote: Mint = program.account(lb_pair_state.token_y_mint).await?;

    let token_programs = program
        .async_rpc()
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?
        .into_iter()
        .map(|account| Some(account?.owner))
        .collect::<Option<Vec<Pubkey>>>()
        .context("Missing token mint account")?;

    let [token_x_program, token_y_program] = token_programs.as_slice() else {
        bail!("Missing token program accounts");
    };

    let min_price_per_lamport = price_per_token_to_per_lamport(
        min_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;
    let min_active_id = get_id_from_price(bin_step, &min_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let max_price_per_lamport = price_per_token_to_per_lamport(
        max_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;
    let max_active_id = get_id_from_price(bin_step, &max_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    assert!(min_active_id < max_active_id);

    let width = MAX_BIN_PER_POSITION as i32;
    for i in min_active_id..=max_active_id {
        let (position, _bump) = derive_position_pda(lb_pair, base_position_key, i, width);

        match program.account::<PositionV2>(position).await {
            Ok(position_state) => {
                let user_token_x = get_or_create_ata(
                    program,
                    transaction_config,
                    lb_pair_state.token_x_mint,
                    program.payer(),
                    *token_x_program,
                )
                .await?;

                let user_token_y = get_or_create_ata(
                    program,
                    transaction_config,
                    lb_pair_state.token_y_mint,
                    program.payer(),
                    *token_y_program,
                )
                .await?;

                let (event_authority, _bump) = derive_event_authority_pda();

                let remove_all_liquidity_ix = create_remove_all_liquidity_ix(
                    lb_pair,
                    position,
                    user_token_x,
                    user_token_y,
                    *token_x_program,
                    *token_y_program,
                    event_authority,
                    &lb_pair_state,
                    &position_state,
                    program,
                )
                .await?;

                let claim_fee_ix = create_claim_fee_ix(
                    lb_pair,
                    position,
                    user_token_x,
                    user_token_y,
                    *token_x_program,
                    *token_y_program,
                    event_authority,
                    &lb_pair_state,
                    &position_state,
                    program,
                )
                .await?;

                let close_position_ix = create_close_position_ix(
                    lb_pair,
                    position,
                    event_authority,
                    &position_state,
                    program,
                )?;

                let instructions = vec![
                    ComputeBudgetInstruction::set_compute_unit_limit(1_400_000),
                    remove_all_liquidity_ix,
                    claim_fee_ix,
                    close_position_ix,
                ];

                let builder = program.request();
                let builder = instructions
                    .into_iter()
                    .fold(builder, |bld, ix| bld.instruction(ix));
                let signature = builder
                    .send_with_spinner_and_config(transaction_config)
                    .await?;
                println!("close position min_bin_id {i} {signature}");
            }
            Err(_err) => continue,
        }
    }
    Ok(())
}

fn create_close_position_ix<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    position: Pubkey,
    event_authority: Pubkey,
    position_state: &PositionV2,
    program: &Program<C>,
) -> Result<Instruction> {
    let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
    let upper_bin_array_idx = lower_bin_array_idx.checked_add(1).context("MathOverflow")?;

    let (bin_array_lower, _bump) = derive_bin_array_pda(lb_pair, lower_bin_array_idx.into());
    let (bin_array_upper, _bump) = derive_bin_array_pda(lb_pair, upper_bin_array_idx.into());

    let ix_accounts = accounts::ClosePosition {
        lb_pair,
        position,
        bin_array_lower,
        bin_array_upper,
        rent_receiver: program.payer(),
        sender: program.payer(),
        event_authority,
        program: lb_clmm::ID,
    }
    .to_account_metas(None);

    let ix_data = instruction::ClaimFee {}.data();

    Ok(Instruction {
        program_id: lb_clmm::ID,
        accounts: ix_accounts,
        data: ix_data,
    })
}

async fn create_claim_fee_ix<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    position: Pubkey,
    user_token_x: Pubkey,
    user_token_y: Pubkey,
    token_x_program: Pubkey,
    token_y_program: Pubkey,
    event_authority: Pubkey,
    lb_pair_state: &LbPair,
    position_state: &PositionV2,
    program: &Program<C>,
) -> Result<Instruction> {
    let mut ix_accounts = accounts::ClaimFee2 {
        lb_pair,
        sender: program.payer(),
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_program_x: token_x_program,
        token_program_y: token_y_program,
        user_token_x,
        user_token_y,
        event_authority,
        program: lb_clmm::ID,
        memo_program: memo::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };

    let transfer_hook_x_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_x_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookX,
        length: transfer_hook_x_accounts.len() as u8,
    });

    let transfer_hook_y_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_y_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookY,
        length: transfer_hook_y_accounts.len() as u8,
    });

    let bin_arrays = get_bin_array_account_meta_by_bin_range(
        position_state.lb_pair,
        position_state.lower_bin_id,
        position_state.upper_bin_id,
    )?;

    ix_accounts.extend(transfer_hook_x_accounts);
    ix_accounts.extend(transfer_hook_y_accounts);
    ix_accounts.extend(bin_arrays);

    let ix_data = instruction::ClaimFee2 {
        min_bin_id: position_state.lower_bin_id,
        max_bin_id: position_state.upper_bin_id,
        remaining_accounts_slice: remaining_accounts_info,
    }
    .data();

    Ok(Instruction {
        program_id: lb_clmm::ID,
        accounts: ix_accounts,
        data: ix_data,
    })
}

async fn create_remove_all_liquidity_ix<C: Deref<Target = impl Signer> + Clone>(
    lb_pair: Pubkey,
    position: Pubkey,
    user_token_x: Pubkey,
    user_token_y: Pubkey,
    token_x_program: Pubkey,
    token_y_program: Pubkey,
    event_authority: Pubkey,
    lb_pair_state: &LbPair,
    position_state: &PositionV2,
    program: &Program<C>,
) -> Result<Instruction> {
    let mut ix_accounts = accounts::ModifyLiquidity2 {
        lb_pair,
        bin_array_bitmap_extension: None,
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        sender: program.payer(),
        user_token_x,
        user_token_y,
        token_x_program,
        token_y_program,
        event_authority,
        program: lb_clmm::ID,
        memo_program: memo::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };

    let transfer_hook_x_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_x_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookX,
        length: transfer_hook_x_accounts.len() as u8,
    });

    let transfer_hook_y_accounts =
        get_extra_account_metas_for_transfer_hook(lb_pair_state.token_y_mint, program.async_rpc())
            .await?;

    remaining_accounts_info.slices.push(RemainingAccountsSlice {
        accounts_type: AccountsType::TransferHookY,
        length: transfer_hook_y_accounts.len() as u8,
    });

    let bin_arrays = get_bin_array_account_meta_by_bin_range(
        position_state.lb_pair,
        position_state.lower_bin_id,
        position_state.upper_bin_id,
    )?;

    ix_accounts.extend(transfer_hook_x_accounts);
    ix_accounts.extend(transfer_hook_y_accounts);
    ix_accounts.extend(bin_arrays);

    let ix_data = instruction::RemoveLiquidityByRange2 {
        from_bin_id: position_state.lower_bin_id,
        to_bin_id: position_state.upper_bin_id,
        bps_to_remove: 10_000,
        remaining_accounts_info,
    }
    .data();

    Ok(Instruction {
        program_id: lb_clmm::ID,
        accounts: ix_accounts,
        data: ix_data,
    })
}
