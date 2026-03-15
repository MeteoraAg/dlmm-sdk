use crate::*;

#[derive(Debug, Parser)]
pub struct SetPermissionlessOperationBitsParams {
    /// Address of the position
    #[clap(long)]
    pub position: Pubkey,
    /// Operation bits to set
    #[clap(long)]
    pub bits: u8,
}

pub async fn execute_set_permissionless_operation_bits<C: Deref<Target = impl Signer> + Clone>(
    params: SetPermissionlessOperationBitsParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPermissionlessOperationBitsParams { position, bits } = params;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = dlmm::client::accounts::SetPermissionlessOperationBits {
        position,
        owner: program.payer(),
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::SetPermissionlessOperationBits { bits }.data();

    let instruction = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(instruction)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Set permissionless operation bits. Signature: {signature:#?}");

    signature?;

    Ok(())
}
