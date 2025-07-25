use crate::*;

#[derive(Debug, Parser)]
pub struct SetPairStatusParams {
    /// Address of the pair
    pub lb_pair: Pubkey,
    /// Pair status. 0 is enabled, 1 is disabled
    pub pair_status: u8,
}

pub async fn execute_set_pair_status<C: Deref<Target = impl Signer> + Clone>(
    params: SetPairStatusParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPairStatusParams {
        lb_pair,
        pair_status,
    } = params;

    let accounts = dlmm::client::accounts::SetPairStatus {
        admin: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::SetPairStatus {
        status: pair_status,
    }
    .data();

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

    println!("Set pair status. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
