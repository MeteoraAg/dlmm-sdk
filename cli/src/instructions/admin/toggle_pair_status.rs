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

    let accounts: [AccountMeta; SET_PAIR_STATUS_IX_ACCOUNTS_LEN] = SetPairStatusKeys {
        admin: program.payer(),
        lb_pair,
    }
    .into();

    let data = SetPairStatusIxData(SetPairStatusIxArgs {
        status: pair_status,
    })
    .try_to_vec()?;

    let instruction = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
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
