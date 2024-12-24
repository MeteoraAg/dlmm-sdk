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

    let accounts: [AccountMeta; SET_ACTIVATION_POINT_IX_ACCOUNTS_LEN] = SetActivationPointKeys {
        admin: program.payer(),
        lb_pair,
    }
    .into();

    let data =
        SetActivationPointIxData(SetActivationPointIxArgs { activation_point }).try_to_vec()?;

    let set_activation_point_ix = Instruction {
        accounts: accounts.to_vec(),
        data,
        program_id: dlmm_interface::ID,
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
