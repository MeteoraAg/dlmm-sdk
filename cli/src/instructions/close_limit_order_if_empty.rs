use crate::*;

#[derive(Debug, Parser)]
pub struct CloseLimitOrderIfEmptyParams {
    /// Address of the limit order account
    #[clap(long)]
    pub limit_order: Pubkey,
}

pub async fn execute_close_limit_order_if_empty<C: Deref<Target = impl Signer> + Clone>(
    params: CloseLimitOrderIfEmptyParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let CloseLimitOrderIfEmptyParams { limit_order } = params;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = dlmm::client::accounts::CloseLimitOrderIfEmpty {
        limit_order,
        owner: program.payer(),
        rent_receiver: program.payer(),
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::CloseLimitOrderIfEmpty {}.data();

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

    println!("Close limit order if empty. Signature: {signature:#?}");

    signature?;

    Ok(())
}
