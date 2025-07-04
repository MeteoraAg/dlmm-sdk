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

    let accounts = dlmm::client::accounts::InitializeTokenBadge {
        admin: program.payer(),
        token_mint: mint,
        system_program: system_program::ID,
        token_badge,
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
