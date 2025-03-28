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

    let accounts = dlmm::client::accounts::UpdateRewardFunder {
        lb_pair,
        admin: program.payer(),
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::UpdateRewardFunder {
        reward_index,
        new_funder: funder,
    }
    .data();

    let ix = Instruction {
        program_id: dlmm::ID,
        accounts,
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
