use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::{InstructionData, ToAccountMetas};

use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::instructions::add_liquidity::{BinLiquidityDistribution, LiquidityParameter};
use lb_clmm::state::position::PositionV2;
use lb_clmm::utils::remaining_accounts_util::{
    AccountsType, RemainingAccountsInfo, RemainingAccountsSlice,
};

use crate::instructions::utils::{
    get_bin_array_account_meta_by_bin_range, get_extra_account_metas_for_transfer_hook,
    get_or_create_ata,
};
use lb_clmm::constants::BASIS_POINT_MAX;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::{derive_bin_array_bitmap_extension, derive_event_authority_pda};

#[derive(Debug)]
pub struct AddLiquidityParam {
    pub lb_pair: Pubkey,
    pub position: Pubkey,
    pub amount_x: u64,
    pub amount_y: u64,
    pub bin_liquidity_distribution: Vec<(i32, f64, f64)>,
}

pub async fn add_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: AddLiquidityParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let AddLiquidityParam {
        lb_pair,
        position,
        amount_x,
        amount_y,
        bin_liquidity_distribution,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;
    let position_state: PositionV2 = program.account(position).await?;

    let mint_x_owner = program
        .async_rpc()
        .get_account(&lb_pair_state.token_x_mint)
        .await
        .map(|acc| acc.owner)?;

    let mint_y_owner = program
        .async_rpc()
        .get_account(&lb_pair_state.token_y_mint)
        .await
        .map(|acc| acc.owner)?;

    let bin_liquidity_distribution = bin_liquidity_distribution
        .into_iter()
        .map(|(bin_id, dist_x, dist_y)| BinLiquidityDistribution {
            bin_id,
            distribution_x: (dist_x * BASIS_POINT_MAX as f64) as u16,
            distribution_y: (dist_y * BASIS_POINT_MAX as f64) as u16,
        })
        .collect::<Vec<_>>();

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
        mint_x_owner,
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
        mint_y_owner,
    )
    .await?;

    let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);
    let bin_array_bitmap_extension = if program
        .rpc()
        .get_account(&bin_array_bitmap_extension)
        .is_err()
    {
        None
    } else {
        Some(bin_array_bitmap_extension)
    };

    let (event_authority, _bump) = derive_event_authority_pda();

    let mut ix_accounts = accounts::ModifyLiquidity2 {
        lb_pair,
        bin_array_bitmap_extension,
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        sender: program.payer(),
        user_token_x,
        user_token_y,
        token_x_program: mint_x_owner,
        token_y_program: mint_y_owner,
        event_authority,
        program: lb_clmm::ID,
        memo_program: anchor_spl::memo::ID,
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
        lb_pair,
        position_state.lower_bin_id,
        position_state.upper_bin_id,
    )?;

    ix_accounts.extend(transfer_hook_x_accounts);
    ix_accounts.extend(transfer_hook_y_accounts);
    ix_accounts.extend(bin_arrays);

    let ix_data = instruction::AddLiquidity2 {
        liquidity_parameter: LiquidityParameter {
            amount_x,
            amount_y,
            bin_liquidity_dist: bin_liquidity_distribution,
        },
        remaining_accounts_info,
    }
    .data();

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let ix = Instruction {
        program_id: lb_clmm::ID,
        accounts: ix_accounts,
        data: ix_data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Add Liquidity. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
