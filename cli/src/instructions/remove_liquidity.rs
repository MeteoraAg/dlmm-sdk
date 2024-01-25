use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;

use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::constants::BASIS_POINT_MAX;
use lb_clmm::instruction;
use lb_clmm::instructions::remove_liquidity::BinLiquidityReduction;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::{derive_bin_array_bitmap_extension, derive_event_authority_pda};

use crate::instructions::utils::{get_bin_arrays_for_position, get_or_create_ata};

pub struct RemoveLiquidityParameters {
    pub lb_pair: Pubkey,
    pub position: Pubkey,
    pub bin_liquidity_removal: Vec<(i32, f64)>,
}

pub async fn remove_liquidity<C: Deref<Target = impl Signer> + Clone>(
    params: RemoveLiquidityParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let RemoveLiquidityParameters {
        lb_pair,
        position,
        bin_liquidity_removal,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair).await?;

    let [bin_array_lower, bin_array_upper] = get_bin_arrays_for_position(&program, position).await?;

    let user_token_x = get_or_create_ata(
        &program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
    ).await?;

    let user_token_y = get_or_create_ata(
        &program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
    ).await?;

    // TODO: id and price slippage
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

    let accounts = accounts::ModifyLiquidity {
        bin_array_lower,
        bin_array_upper,
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
        token_x_program: anchor_spl::token::ID,
        token_y_program: anchor_spl::token::ID,
        event_authority,
        program: lb_clmm::ID,
    };

    let bin_liquidity_removal = bin_liquidity_removal
        .into_iter()
        .map(|(bin_id, bps)| BinLiquidityReduction {
            bin_id,
            bps_to_remove: (bps * BASIS_POINT_MAX as f64) as u16,
        })
        .collect::<Vec<BinLiquidityReduction>>();

    let ix = instruction::RemoveLiquidity {
        bin_liquidity_removal,
    };

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config).await;

    println!("Remove Liquidity. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
