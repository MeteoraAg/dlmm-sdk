use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::compute_budget::ComputeBudgetInstruction;
use anchor_client::solana_sdk::signer::Signer;
use anchor_client::Program;
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::position::Position;
use lb_clmm::utils::pda::derive_event_authority_pda;
use std::ops::Deref;

use super::utils::get_bin_arrays_for_position;

pub async fn close_position<C: Deref<Target = impl Signer> + Clone>(
    position: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let position_state: Position = program.account(position).await?;
    let [bin_array_lower, bin_array_upper] = get_bin_arrays_for_position(program, position).await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::ClosePosition {
        bin_array_lower,
        bin_array_upper,
        lb_pair: position_state.lb_pair,
        sender: position_state.owner,
        rent_receiver: position_state.owner,
        position,
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::ClosePosition {};
    let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

    let request_builder = program.request();
    let signature = request_builder
        .instruction(compute_budget_ix)
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Close position. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
