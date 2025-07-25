use crate::*;

#[derive(Debug, Parser)]
pub struct SetPairStatusPermissionlessParams {
    #[clap(long)]
    pub lb_pair: Pubkey,
    #[clap(long)]
    pub enable: bool,
}

pub async fn execute_set_pair_status_permissionless<C: Deref<Target = impl Signer> + Clone>(
    params: SetPairStatusPermissionlessParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPairStatusPermissionlessParams { lb_pair, enable } = params;

    let accounts = dlmm::client::accounts::SetPairStatusPermissionless {
        creator: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let status = if enable { 1 } else { 0 };

    let data = dlmm::client::args::SetPairStatusPermissionless { status }.data();

    let set_pair_status_permissionless_ix = Instruction {
        accounts,
        data,
        program_id: dlmm::ID,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(set_pair_status_permissionless_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Set pair status permissionless. Signature: {:#?}",
        signature
    );

    signature?;

    Ok(())
}
