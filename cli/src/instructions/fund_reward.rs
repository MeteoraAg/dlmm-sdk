use crate::instructions::utils::get_or_create_ata;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::{solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program};
use anyhow::*;
use lb_clmm::accounts;
use lb_clmm::instruction;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::lb_pair::LbPair;
use lb_clmm::utils::pda::*;
use std::ops::Deref;

#[derive(Debug)]
pub struct FundRewardParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub funding_amount: u64,
}

pub fn fund_reward<C: Deref<Target = impl Signer> + Clone>(
    params: FundRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let FundRewardParams {
        lb_pair,
        reward_index,
        funding_amount,
    } = params;

    let (reward_vault, _bump) = Pubkey::find_program_address(
        &[lb_pair.as_ref(), reward_index.to_le_bytes().as_ref()],
        &lb_clmm::ID,
    );
    let lb_pair_state: LbPair = program.account(lb_pair)?;
    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let funder_token_account =
        get_or_create_ata(&program, transaction_config, reward_mint, program.payer())?;

    let active_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id)?;
    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, active_bin_array_idx as i64);

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = accounts::FundReward {
        lb_pair,
        reward_vault,
        reward_mint,
        funder: program.payer(),
        funder_token_account,
        bin_array,
        token_program: anchor_spl::token::ID,
        event_authority,
        program: lb_clmm::ID,
    };

    let ix = instruction::FundReward {
        reward_index,
        amount: funding_amount,
        carry_forward: true,
    };

    let request_builder = program.request();
    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Fund reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
