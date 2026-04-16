use crate::*;

#[derive(Debug, Parser)]
pub struct CloseTokenBadgeParams {
    /// Token mint address
    #[clap(long)]
    pub mint: Pubkey,
}

pub async fn execute_close_token_badge<C: Deref<Target = impl Signer> + Clone>(
    params: CloseTokenBadgeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let CloseTokenBadgeParams { mint } = params;

    let (token_badge, _bump) = derive_token_badge_pda(mint);
    let (operator, _bump) = derive_operator_pda(program.payer());

    let accounts = dlmm::client::accounts::CloseTokenBadge {
        token_badge,
        rent_receiver: program.payer(),
        operator,
        signer: program.payer(),
    }
    .to_account_metas(None);

    let data = dlmm::client::args::CloseTokenBadge {}.data();

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

    println!("Close token badge {}. Signature: {signature:#?}", mint);

    signature?;

    Ok(())
}
