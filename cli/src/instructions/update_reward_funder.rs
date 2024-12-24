use crate::*;

#[derive(Debug, Parser)]
pub struct UpdateRewardFunderParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub funder: Pubkey,
}

pub async fn execute_update_reward_funder<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateRewardFunderParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let UpdateRewardFunderParams {
        lb_pair,
        reward_index,
        funder,
    } = params;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; UPDATE_REWARD_FUNDER_IX_ACCOUNTS_LEN] = UpdateRewardFunderKeys {
        lb_pair,
        admin: program.payer(),
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let data = UpdateRewardFunderIxData(UpdateRewardFunderIxArgs {
        reward_index,
        new_funder: funder,
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
