use crate::*;

#[derive(Debug, Parser)]
pub struct UpdateRewardDurationParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub reward_duration: u64,
}

pub async fn execute_update_reward_duration<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateRewardDurationParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let UpdateRewardDurationParams {
        lb_pair,
        reward_index,
        reward_duration,
    } = params;

    let rpc_client = program.async_rpc();
    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let active_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id)?;
    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, active_bin_array_idx as i64);

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; UPDATE_REWARD_DURATION_IX_ACCOUNTS_LEN] =
        UpdateRewardDurationKeys {
            lb_pair,
            admin: program.payer(),
            bin_array,
            event_authority,
            program: dlmm_interface::ID,
        }
        .into();

    let data = UpdateRewardDurationIxData(UpdateRewardDurationIxArgs {
        reward_index,
        new_duration: reward_duration,
    })
    .try_to_vec()?;

    let ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Fund reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
