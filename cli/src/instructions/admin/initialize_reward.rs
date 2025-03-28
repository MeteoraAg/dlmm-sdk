use crate::*;

#[derive(Debug, Parser)]
pub struct InitializeRewardParams {
    pub lb_pair: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_index: u64,
    pub reward_duration: u64,
    pub funder: Pubkey,
}

pub async fn execute_initialize_reward<C: Deref<Target = impl Signer> + Clone>(
    params: InitializeRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let InitializeRewardParams {
        lb_pair,
        reward_mint,
        reward_index,
        reward_duration,
        funder,
    } = params;

    let (reward_vault, _bump) = derive_reward_vault_pda(lb_pair, reward_index);
    let (event_authority, _bump) = derive_event_authority_pda();

    let rpc_client = program.rpc();
    let reward_mint_account = rpc_client.get_account(&reward_mint).await?;

    let (token_badge, _bump) = derive_token_badge_pda(reward_mint);
    let token_badge = rpc_client
        .get_account(&token_badge)
        .await
        .ok()
        .map(|_| token_badge)
        .or(Some(dlmm::ID));

    let accounts = dlmm::client::accounts::InitializeReward {
        lb_pair,
        reward_vault,
        reward_mint,
        admin: program.payer(),
        token_program: reward_mint_account.owner,
        token_badge,
        rent: solana_sdk::sysvar::rent::ID,
        system_program: solana_sdk::system_program::ID,
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::InitializeReward {
        reward_index,
        reward_duration,
        funder,
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

    println!("Initialize reward. Signature: {signature:#?}");

    signature?;

    Ok(())
}
