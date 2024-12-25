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

    let accounts: [AccountMeta; INITIALIZE_TOKEN_BADGE_IX_ACCOUNTS_LEN] =
        InitializeTokenBadgeKeys {
            admin: program.payer(),
            token_mint: mint,
            system_program: system_program::ID,
            token_badge,
        }
        .into();

    let data = InitializeTokenBadgeIxData;

    let instruction = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data: data.try_to_vec()?,
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
