use crate::*;

#[derive(Debug, Parser)]
pub struct SetPreactivationDurationParam {
    pub lb_pair: Pubkey,
    pub pre_activation_duration: u16,
}

pub async fn execute_set_pre_activation_duration<C: Deref<Target = impl Signer> + Clone>(
    params: SetPreactivationDurationParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPreactivationDurationParam {
        lb_pair,
        pre_activation_duration,
    } = params;

    let accounts = dlmm::client::accounts::SetPreActivationDuration {
        creator: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::SetPreActivationDuration {
        pre_activation_duration: pre_activation_duration as u64,
    }
    .data();

    let set_pre_activation_slot_duration_ix = Instruction {
        accounts,
        data,
        program_id: dlmm::ID,
    };

    let request_builder = program.request();

    let signature = request_builder
        .instruction(set_pre_activation_slot_duration_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set pre activation duration. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
