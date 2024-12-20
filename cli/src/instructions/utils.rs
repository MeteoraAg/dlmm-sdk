use crate::*;
use anchor_client::solana_client::nonblocking::rpc_client::RpcClient;
use anchor_client::solana_client::rpc_client::RpcClient as BlockingRpcClient;
use anchor_spl::{
    token::spl_token,
    token_2022::spl_token_2022::extension::{transfer_hook, StateWithExtensions},
};
use spl_associated_token_account::{
    get_associated_token_address, instruction::create_associated_token_account,
};
use spl_transfer_hook_interface::offchain::add_extra_account_metas_for_execute;

pub async fn get_or_create_ata<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    token_mint: Pubkey,
    wallet_address: Pubkey,
) -> Result<Pubkey> {
    let user_ata = get_associated_token_address(&wallet_address, &token_mint);

    let rpc_client = program.async_rpc();
    let user_ata_exists = rpc_client.get_account(&user_ata).await.is_ok();

    match user_ata_exists {
        true => Ok(user_ata),
        false => {
            let builder = program
                .request()
                .instruction(create_associated_token_account(
                    &program.payer(),
                    &wallet_address,
                    &token_mint,
                    &spl_token::ID,
                ));

            builder
                .send_with_spinner_and_config(transaction_config)
                .await?;
            Ok(user_ata)
        }
    }
}

pub async fn get_extra_account_metas_for_transfer_hook(
    mint: Pubkey,
    rpc_client: RpcClient,
) -> Result<Vec<AccountMeta>> {
    let mint_account = rpc_client.get_account(&mint).await?;
    if mint_account.owner.eq(&spl_token::ID) {
        return Ok(vec![]);
    }

    let mint_state =
        StateWithExtensions::<anchor_spl::token_2022::spl_token_2022::state::Mint>::unpack(
            mint_account.data.as_ref(),
        )?;

    if let Some(transfer_hook_program_id) = transfer_hook::get_program_id(&mint_state) {
        let mut transfer_ix =
            anchor_spl::token_2022::spl_token_2022::instruction::transfer_checked(
                &mint_account.owner,
                &Pubkey::default(),
                &mint,
                &Pubkey::default(),
                &Pubkey::default(),
                &[],
                0,
                mint_state.base.decimals,
            )?;

        let blocking_rpc_client = BlockingRpcClient::new(rpc_client.url());

        let data_fetcher = |address: Pubkey| {
            let account = blocking_rpc_client
                .get_account(&address)
                .map(|account| account.data);
            async move {
                std::result::Result::Ok::<Option<Vec<u8>>, Box<dyn std::error::Error + Send + Sync>>(
                    account.ok(),
                )
            }
        };

        add_extra_account_metas_for_execute(
            &mut transfer_ix,
            &transfer_hook_program_id,
            &Pubkey::default(),
            &mint,
            &Pubkey::default(),
            &Pubkey::default(),
            0,
            data_fetcher,
        )
        .await
        .map_err(|e| anyhow!(e))?;

        // Skip 0 -> 4, source, mint, destination, authority
        let transfer_hook_required_accounts = transfer_ix.accounts[5..].to_vec();
        return Ok(transfer_hook_required_accounts);
    }

    Ok(vec![])
}
