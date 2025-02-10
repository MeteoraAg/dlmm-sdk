use crate::*;
use instructions::*;

#[derive(Debug, Parser)]
pub struct ClaimRewardParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub position: Pubkey,
}

pub async fn execute_claim_reward<C: Deref<Target = impl Signer> + Clone>(
    params: ClaimRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let ClaimRewardParams {
        lb_pair,
        reward_index,
        position,
    } = params;

    let rpc_client = program.async_rpc();
    let (reward_vault, _bump) = derive_reward_vault_pda(lb_pair, reward_index);

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(PositionV2Account::deserialize(&account.data)?.0)
        })
        .await?;

    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let reward_mint_program = rpc_client.get_account(&reward_mint).await?.owner;

    let user_token_account = get_or_create_ata(
        program,
        transaction_config,
        reward_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts: [AccountMeta; CLAIM_REWARD2_IX_ACCOUNTS_LEN] = ClaimReward2Keys {
        lb_pair,
        reward_vault,
        reward_mint,
        memo_program: spl_memo::ID,
        token_program: reward_mint_program,
        position,
        user_token_account,
        sender: program.payer(),
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut token_2022_remaining_accounts = vec![];

    if let Some((slices, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.async_rpc(),
            ActionType::Reward(reward_index as usize),
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        token_2022_remaining_accounts.extend(transfer_hook_remaining_accounts);
    };

    for (min_bin_id, max_bin_id) in
        position_bin_range_chunks(position_state.lower_bin_id, position_state.upper_bin_id)
    {
        let data = ClaimReward2IxData(ClaimReward2IxArgs {
            reward_index,
            min_bin_id,
            max_bin_id,
            remaining_accounts_info: remaining_accounts_info.clone(),
        })
        .try_to_vec()?;

        let bin_arrays_account_meta =
            position_state.get_bin_array_accounts_meta_coverage_by_chunk(min_bin_id, max_bin_id)?;

        let accounts = [
            main_accounts.to_vec(),
            token_2022_remaining_accounts.clone(),
            bin_arrays_account_meta,
        ]
        .concat();

        let claim_reward_ix = Instruction {
            program_id: dlmm_interface::ID,
            accounts,
            data,
        };

        let request_builder = program.request();
        let signature = request_builder
            .instruction(claim_reward_ix)
            .send_with_spinner_and_config(transaction_config)
            .await;

        println!("Claim reward. Signature: {:#?}", signature);

        signature?;
    }

    Ok(())
}
