use crate::*;

#[derive(Debug, Parser)]
pub struct SetActivationPointParam {
    /// Address of the pair
    pub lb_pair: Pubkey,
    /// Activation point
    pub activation_point: u64,
}

pub async fn execute_set_activation_point<C: Deref<Target = impl Signer> + Clone>(
    params: SetActivationPointParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetActivationPointParam {
        lb_pair,
        activation_point,
    } = params;

    let accounts = dlmm::client::accounts::SetActivationPoint {
        admin: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::SetActivationPoint { activation_point }.data();

    let set_activation_point_ix = Instruction {
        accounts,
        data,
        program_id: dlmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(set_activation_point_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set activation point. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
