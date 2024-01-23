use super::utils::{get_bin_arrays_for_position, get_or_create_ata};
use anchor_client::{
    solana_client::rpc_config::RpcSendTransactionConfig, solana_sdk::signer::Signer, Program,
};
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::{lb_pair::LbPair, position::Position};
use lb_clmm::utils::pda::derive_event_authority_pda;
use std::ops::Deref;

pub async fn claim_fee<C: Deref<Target = impl Signer> + Clone>(
    position: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let position_state: Position = program.account(position).await?;
    let lb_pair_state: LbPair = program.account(position_state.lb_pair).await?;

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
    ).await?;
    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
    ).await?;

    let [bin_array_lower, bin_array_upper] = get_bin_arrays_for_position(&program, position).await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::ClaimFee {
        bin_array_lower,
        bin_array_upper,
        lb_pair: position_state.lb_pair,
        sender: program.payer(),
        position,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_program: anchor_spl::token::ID,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        user_token_x,
        user_token_y,
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::ClaimFee {};

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config).await;

    println!("Claim fee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
