use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::associated_token::get_associated_token_address;
use anyhow::*;
use dlmm_common::utils::find_next_bin_array_index_with_liquidity;
use dlmm_program_interface::accounts;
use dlmm_program_interface::instruction;
use dlmm_program_interface::state::bin::{
    bin_id_to_bin_array_index, get_bin_array_lower_upper_bin_id,
};
use dlmm_program_interface::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use dlmm_program_interface::state::lb_pair::LbPair;
use dlmm_program_interface::utils::pda::derive_bin_array_pda;
use dlmm_program_interface::utils::pda::*;
use std::ops::Deref;

#[derive(Debug)]
pub struct SwapParameters {
    pub lb_pair: Pubkey,
    pub amount_in: u64,
    pub swap_for_y: bool,
}

pub fn swap<C: Deref<Target = impl Signer> + Clone>(
    params: SwapParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SwapParameters {
        amount_in,
        lb_pair,
        swap_for_y,
    } = params;

    let lb_pair_state: LbPair = program.account(lb_pair)?;
    let (bitmap_extension_pubkey, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    let extension_bitmap: Option<BinArrayBitmapExtension> =
        program.account(bitmap_extension_pubkey).ok();

    let active_bin_array_idx = bin_id_to_bin_array_index(lb_pair_state.active_id);
    let (bin_array_0, _bump) = derive_bin_array_pda(lb_pair, active_bin_array_idx as i64);

    let mut bin_array_idx = active_bin_array_idx;

    let mut bin_arrays_pubkey = vec![bin_array_0];

    loop {
        if bin_arrays_pubkey.len() == 3 {
            break;
        }
        let (lower_bin_id, upper_bin_id) = get_bin_array_lower_upper_bin_id(bin_array_idx);
        let edge_bin_id = if swap_for_y {
            lower_bin_id
        } else {
            upper_bin_id
        };

        let std::result::Result::Ok(Some(next_bin_array_idx)) =
            find_next_bin_array_index_with_liquidity(
                edge_bin_id,
                swap_for_y,
                &lb_pair_state.bin_array_bitmap,
                extension_bitmap.as_ref(),
            )
        else {
            break;
        };

        let (bin_array, _bump) = derive_bin_array_pda(lb_pair, next_bin_array_idx.into());
        bin_arrays_pubkey.push(bin_array);

        bin_array_idx = next_bin_array_idx;
    }

    let (user_token_in, user_token_out) = if swap_for_y {
        (
            get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint),
            get_associated_token_address(&program.payer(), &lb_pair_state.token_y_mint),
        )
    } else {
        (
            get_associated_token_address(&program.payer(), &lb_pair_state.token_y_mint),
            get_associated_token_address(&program.payer(), &lb_pair_state.token_x_mint),
        )
    };

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

    let accounts = accounts::Swap {
        lb_pair,
        bin_array_bitmap_extension,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        token_x_program: anchor_spl::token::ID,
        token_y_program: anchor_spl::token::ID,
        user: program.payer(),
        user_token_in,
        user_token_out,
        oracle: lb_pair_state.oracle,
        host_fee_in: Some(dlmm_program_interface::ID),
        event_authority,
        program: dlmm_program_interface::ID,
    };

    let ix = instruction::Swap {
        amount_in,
        min_amount_out: 0,
    };

    let remaining_accounts: Vec<AccountMeta> = bin_arrays_pubkey
        .into_iter()
        .map(|pubkey| AccountMeta {
            is_signer: false,
            is_writable: true,
            pubkey,
        })
        .collect();

    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .accounts(accounts)
        .accounts(remaining_accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Swap. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
