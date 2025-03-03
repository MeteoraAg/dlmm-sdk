use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anchor_spl::token::Mint;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::instructions::initialize_pool::CustomizableParams;
use lb_clmm::math::u128x128_math::Rounding;
use lb_clmm::utils::pda::*;
use std::ops::Deref;

use crate::instructions::utils::get_or_create_ata;
use crate::math::{
    compute_base_factor_from_fee_bps, get_id_from_price, get_precise_id_from_price,
    price_per_token_to_per_lamport,
};
use crate::SelectiveRounding;

#[derive(Debug)]
pub struct InitCustomizablePermissionlessLbPairParameters {
    pub token_mint_x: Pubkey,
    pub token_mint_y: Pubkey,
    pub bin_step: u16,
    pub initial_price: f64,
    pub base_fee_bps: u16,
    pub activation_type: u8,
    pub has_alpha_vault: bool,
    pub activation_point: Option<u64>,
    pub selective_rounding: SelectiveRounding,
    pub creator_pool_on_off_control: bool,
}

pub async fn initialize_customizable_permissionless_lb_pair<
    C: Deref<Target = impl Signer> + Clone,
>(
    params: InitCustomizablePermissionlessLbPairParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<Pubkey> {
    let InitCustomizablePermissionlessLbPairParameters {
        bin_step,
        token_mint_x,
        token_mint_y,
        initial_price,
        base_fee_bps,
        activation_type,
        activation_point,
        has_alpha_vault,
        selective_rounding,
        creator_pool_on_off_control,
    } = params;

    let token_mint_base: Mint = program.account(token_mint_x).await?;
    let token_mint_quote: Mint = program.account(token_mint_y).await?;

    let price_per_lamport = price_per_token_to_per_lamport(
        initial_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let computed_active_id = match selective_rounding {
        SelectiveRounding::None => get_precise_id_from_price(bin_step, &price_per_lamport)
            .context("fail to get exact bin id for the price"),
        SelectiveRounding::Down => get_id_from_price(bin_step, &price_per_lamport, Rounding::Down)
            .context("get_id_from_price overflow"),
        SelectiveRounding::Up => get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
            .context("get_id_from_price overflow"),
    }?;

    let (lb_pair, _bump) = derive_customizable_permissionless_lb_pair(token_mint_x, token_mint_y);

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();
    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        token_mint_x,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;
    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        token_mint_y,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let accounts = accounts::InitializeCustomizablePermissionlessLbPair {
        lb_pair,
        bin_array_bitmap_extension: None,
        reserve_x,
        reserve_y,
        token_mint_x,
        token_mint_y,
        oracle,
        funder: program.payer(),
        system_program: anchor_client::solana_sdk::system_program::ID,
        token_program: anchor_spl::token::ID,
        event_authority,
        user_token_x,
        user_token_y,
        program: lb_clmm::ID,
    };

    let ix = instruction::InitializeCustomizablePermissionlessLbPair {
        params: CustomizableParams {
            active_id: computed_active_id,
            bin_step,
            base_factor: compute_base_factor_from_fee_bps(bin_step, base_fee_bps)?,
            activation_type,
            activation_point,
            has_alpha_vault,
            creator_pool_on_off_control,
            padding: [0u8; 63],
        },
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize Customizable LB pair {lb_pair}. Signature: {signature:#?}");

    signature?;

    println!("{lb_pair}");

    Ok(lb_pair)
}
