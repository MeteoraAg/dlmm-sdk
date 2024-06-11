use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::state::preset_parameters::PresetParameter;
use lb_clmm::utils::pda::*;

use crate::math::{get_id_from_price, price_per_token_to_per_lamport};

#[derive(Debug)]
pub struct InitLbPairParameters {
    pub token_mint_x: Pubkey,
    pub token_mint_y: Pubkey,
    pub preset_parameter: Pubkey,
    pub initial_price: f64,
}

pub async fn initialize_lb_pair<C: Deref<Target = impl Signer> + Clone>(
    params: InitLbPairParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitLbPairParameters {
        preset_parameter,
        token_mint_x,
        token_mint_y,
        initial_price,
    } = params;

    let token_mint_base: Mint = program.account(token_mint_x).await?;
    let token_mint_quote: Mint = program.account(token_mint_y).await?;

    let token_programs = program
        .async_rpc()
        .get_multiple_accounts(&[token_mint_x, token_mint_y])
        .await?
        .into_iter()
        .map(|account| Some(account?.owner))
        .collect::<Option<Vec<Pubkey>>>()
        .context("Missing token mint account")?;

    let [token_x_program, token_y_program] = token_programs.as_slice() else {
        bail!("Missing token program accounts");
    };

    let token_badge_keys = [token_mint_x, token_mint_y]
        .into_iter()
        .map(|key| derive_token_badge_pda(key).0)
        .collect::<Vec<_>>();

    let token_badge_accounts = program
        .async_rpc()
        .get_multiple_accounts(&token_badge_keys)
        .await?;

    let token_badges = token_badge_accounts
        .into_iter()
        .zip(token_badge_keys)
        .into_iter()
        .map(|(account, key)| Some(account.map_or(lb_clmm::ID, |_| key)))
        .collect::<Vec<_>>();

    let [token_x_badge, token_y_badge] = token_badges.as_slice() else {
        bail!("Invalid derived token badge");
    };

    let price_per_lamport = price_per_token_to_per_lamport(
        initial_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let preset_parameter_state = program.account::<PresetParameter>(preset_parameter).await?;
    let bin_step = preset_parameter_state.bin_step;

    let computed_active_id = get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let (lb_pair, _bump) = derive_lb_pair_pda2(
        token_mint_x,
        token_mint_y,
        bin_step,
        preset_parameter_state.base_factor,
    );

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::InitializeLbPair2 {
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
        token_program_x: *token_x_program,
        token_program_y: *token_y_program,
        token_badge_x: *token_x_badge,
        token_badge_y: *token_y_badge,
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
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize LB pair {lb_pair}. Signature: {signature:#?}");

    signature?;

    Ok(lb_pair)
}
