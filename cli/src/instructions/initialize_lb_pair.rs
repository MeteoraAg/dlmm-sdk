use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::signature::Keypair;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};

use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::utils::pda::*;

use crate::math::{get_id_from_price, price_per_token_to_per_lamport};

#[derive(Debug)]
pub struct InitLbPairParameters {
    pub token_mint_x: Pubkey,
    pub token_mint_y: Pubkey,
    pub bin_step: u16,
    pub initial_price: f64,
    pub permission: bool,
}

pub fn initialize_lb_pair<C: Deref<Target = impl Signer> + Clone>(
    params: InitLbPairParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitLbPairParameters {
        bin_step,
        token_mint_x,
        token_mint_y,
        initial_price,
        permission,
    } = params;

    let token_mint_base: Mint = program.account(token_mint_x)?;
    let token_mint_quote: Mint = program.account(token_mint_y)?;

    let price_per_lamport = price_per_token_to_per_lamport(
        initial_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let computed_active_id = get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let (lb_pair, _bump) = derive_lb_pair_pda(token_mint_x, token_mint_y, bin_step, permission);

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();

    let (preset_parameter, _bump) = derive_preset_parameter_pda(bin_step);

    if permission {
        let base_kp = Keypair::new();
        let accounts = accounts::InitializePermissionLbPair {
            base: base_kp.pubkey(),
            lb_pair,
            bin_array_bitmap_extension: None,
            reserve_x,
            reserve_y,
            token_mint_x,
            token_mint_y,
            oracle,
            admin: program.payer(),
            preset_parameter,
            rent: anchor_client::solana_sdk::sysvar::rent::ID,
            system_program: anchor_client::solana_sdk::system_program::ID,
            token_program: anchor_spl::token::ID,
            event_authority,
            program: lb_clmm::ID,
        };

        let ix = instruction::InitializePermissionLbPair {
            active_id: computed_active_id,
            bin_step,
        };

        let request_builder = program.request();
        let signature = request_builder
            .accounts(accounts)
            .args(ix)
            .signer(&base_kp)
            .send_with_spinner_and_config(transaction_config);

        println!("Initialize Permission LB pair {lb_pair}. Signature: {signature:#?}");

        signature?;
    } else {
        let accounts = accounts::InitializeLbPair {
            lb_pair,
            bin_array_bitmap_extension: None,
            reserve_x,
            reserve_y,
            token_mint_x,
            token_mint_y,
            oracle,
            funder: program.payer(),
            preset_parameter,
            rent: anchor_client::solana_sdk::sysvar::rent::ID,
            system_program: anchor_client::solana_sdk::system_program::ID,
            token_program: anchor_spl::token::ID,
            event_authority,
            program: lb_clmm::ID,
        };

        let ix = instruction::InitializeLbPair {
            active_id: computed_active_id,
            bin_step,
        };

        let request_builder = program.request();
        let signature = request_builder
            .accounts(accounts)
            .args(ix)
            .send_with_spinner_and_config(transaction_config);

        println!("Initialize LB pair {lb_pair}. Signature: {signature:#?}");

        signature?;
    }

    Ok(lb_pair)
}
