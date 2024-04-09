use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::signature::Keypair;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::instructions::initialize_permission_lb_pair::InitPermissionPairIx;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::utils::pda::*;

use crate::math::{
    compute_base_factor_from_fee_bps, find_swappable_min_max_bin_id, get_id_from_price,
    price_per_token_to_per_lamport,
};

#[derive(Debug)]
pub struct InitPermissionLbPairParameters {
    pub token_mint_x: Pubkey,
    pub token_mint_y: Pubkey,
    pub bin_step: u16,
    pub initial_price: f64,
    pub base_fee_bps: u16,
    pub base_keypair: Keypair,
    pub lock_duration_in_slot: u64,
}

pub async fn initialize_permission_lb_pair<C: Deref<Target = impl Signer> + Clone>(
    params: InitPermissionLbPairParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPermissionLbPairParameters {
        bin_step,
        token_mint_x,
        token_mint_y,
        initial_price,
        base_fee_bps,
        base_keypair,
        lock_duration_in_slot,
    } = params;

    let token_mint_base: Mint = program.account(token_mint_x).await?;
    let token_mint_quote: Mint = program.account(token_mint_y).await?;

    let price_per_lamport = price_per_token_to_per_lamport(
        initial_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let computed_active_id = get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let (lb_pair, _bump) =
        derive_permission_lb_pair_pda(base_keypair.pubkey(), token_mint_x, token_mint_y, bin_step);

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::InitializePermissionLbPair {
        lb_pair,
        bin_array_bitmap_extension: None,
        reserve_x,
        reserve_y,
        token_mint_x,
        token_mint_y,
        oracle,
        admin: program.payer(),
        rent: anchor_client::solana_sdk::sysvar::rent::ID,
        system_program: anchor_client::solana_sdk::system_program::ID,
        token_program: anchor_spl::token::ID,
        event_authority,
        program: lb_clmm::ID,
        base: base_keypair.pubkey(),
    };

    let (min_bin_id, max_bin_id) = find_swappable_min_max_bin_id(bin_step)?;

    let ix = instruction::InitializePermissionLbPair {
        ix_data: InitPermissionPairIx {
            active_id: computed_active_id,
            bin_step,
            base_factor: compute_base_factor_from_fee_bps(bin_step, base_fee_bps)?,
            max_bin_id,
            min_bin_id,
            lock_duration_in_slot,
        },
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .signer(&base_keypair)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize Permission LB pair {lb_pair}. Signature: {signature:#?}");

    signature?;

    println!("{lb_pair}");

    Ok(lb_pair)
}
