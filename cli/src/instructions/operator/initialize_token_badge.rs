use crate::*;
use solana_sdk::system_program;

#[derive(Debug, Parser)]
pub struct InitializeTokenBadgeParams {
    /// Token mint address
    pub mint: Pubkey,
}

pub async fn execute_initialize_token_badge<C: Deref<Target = impl Signer> + Clone>(
    params: InitializeTokenBadgeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let InitializeTokenBadgeParams { mint } = params;

    let (token_badge, _bump) = derive_token_badge_pda(mint);

    let (operator, _bump) = derive_operator_pda(program.payer());

    let accounts = dlmm::client::accounts::InitializeTokenBadge {
        token_mint: mint,
        token_badge,
        operator,
        signer: program.payer(),
        payer: program.payer(),
        system_program: system_program::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::InitializeTokenBadge {}.data();

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

    println!("Initialize token badge {}. Signature: {signature:#?}", mint);

    signature?;

    Ok(())
}
