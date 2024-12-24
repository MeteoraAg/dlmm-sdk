use crate::*;
use anchor_client::solana_client::nonblocking::rpc_client::RpcClient;
use anchor_client::solana_client::rpc_client::RpcClient as BlockingRpcClient;
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::spl_token,
    token_2022::spl_token_2022::extension::{transfer_hook, StateWithExtensions},
};
use solana_sdk::program_pack::Pack;
use spl_associated_token_account::instruction::create_associated_token_account;
use spl_transfer_hook_interface::offchain::add_extra_account_metas_for_execute;

pub async fn get_transfer_instruction(
    from: Pubkey,
    to: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    rpc_client: RpcClient,
    amount: u64,
) -> Result<Instruction> {
    let account = rpc_client.get_account(&mint).await?;

    if account.owner.eq(&spl_token::ID) {
        let mint_state = spl_token::state::Mint::unpack(account.data.as_ref())?;
        Ok(spl_token::instruction::transfer_checked(
            &account.owner,
            &from,
            &mint,
            &to,
            &owner,
            &[],
            amount,
            mint_state.decimals,
        )?)
    } else {
        let mint_state =
            StateWithExtensions::<anchor_spl::token_2022::spl_token_2022::state::Mint>::unpack(
                account.data.as_ref(),
            )?;

        let mut transfer_ix =
            anchor_spl::token_2022::spl_token_2022::instruction::transfer_checked(
                &account.owner,
                &from,
                &mint,
                &to,
                &owner,
                &[],
                amount,
                mint_state.base.decimals,
            )?;

        if let Some(transfer_hook_program_id) = transfer_hook::get_program_id(&mint_state) {
            let blocking_rpc_client = BlockingRpcClient::new(rpc_client.url());

            let data_fetcher = |address: Pubkey| {
                let account = blocking_rpc_client
                    .get_account(&address)
                    .map(|account| account.data);
                async move {
                    std::result::Result::Ok::<
                        Option<Vec<u8>>,
                        Box<dyn std::error::Error + Send + Sync>,
                    >(account.ok())
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
        }

        Ok(transfer_ix)
    }
}

pub async fn get_or_create_ata<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    token_mint: Pubkey,
    wallet_address: Pubkey,
) -> Result<Pubkey> {
    let rpc_client = program.async_rpc();
    let token_mint_owner = rpc_client.get_account(&token_mint).await?.owner;

    let user_ata = get_associated_token_address_with_program_id(
        &wallet_address,
        &token_mint,
        &token_mint_owner,
    );
    let user_ata_exists = rpc_client.get_account(&user_ata).await.is_ok();

    if !user_ata_exists {
        let builder = program
            .request()
            .instruction(create_associated_token_account(
                &program.payer(),
                &wallet_address,
                &token_mint,
                &token_mint_owner,
            ));

        builder
            .send_with_spinner_and_config(transaction_config)
            .await?;
    }

    Ok(user_ata)
}

pub enum ActionType {
    LiquidityProvision,
    LiquidityMining(usize),
}

pub async fn get_potential_token_2022_related_ix_data_and_accounts(
    lb_pair: &LbPair,
    rpc_client: RpcClient,
    action_type: ActionType,
) -> Result<Option<(Vec<RemainingAccountsSlice>, Vec<AccountMeta>)>> {
    let potential_token_2022_mints = match action_type {
        ActionType::LiquidityProvision => {
            vec![
                (lb_pair.token_x_mint, AccountsType::TransferHookX),
                (lb_pair.token_y_mint, AccountsType::TransferHookY),
            ]
        }
        ActionType::LiquidityMining(idx) => {
            vec![(
                lb_pair.reward_infos[idx].mint,
                AccountsType::TransferHookReward,
            )]
        }
    };

    let mut slices = vec![];
    let mut accounts = vec![];

    for (mint, accounts_type) in potential_token_2022_mints {
        let extra_account_metas =
            get_extra_account_metas_for_transfer_hook(mint, RpcClient::new(rpc_client.url()))
                .await?;

        if !extra_account_metas.is_empty() {
            slices.push(RemainingAccountsSlice {
                accounts_type,
                length: extra_account_metas.len() as u8,
            });

            accounts.extend(extra_account_metas);
        }
    }

    if !slices.is_empty() {
        Ok(Some((slices, accounts)))
    } else {
        Ok(None)
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
