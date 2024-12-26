use crate::*;
use anchor_client::solana_client::nonblocking::rpc_client::RpcClient;
use anchor_client::solana_client::rpc_client::RpcClient as BlockingRpcClient;
use anchor_spl::{
    token::spl_token,
    token_2022::spl_token_2022::extension::{transfer_hook, StateWithExtensions},
};
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey};
use spl_transfer_hook_interface::offchain::add_extra_account_metas_for_execute;

pub enum ActionType {
    Liquidity,
    Reward(usize),
}

pub async fn get_potential_token_2022_related_ix_data_and_accounts(
    lb_pair: &LbPair,
    rpc_client: RpcClient,
    action_type: ActionType,
) -> Result<Option<(Vec<RemainingAccountsSlice>, Vec<AccountMeta>)>> {
    let potential_token_2022_mints = match action_type {
        ActionType::Liquidity => {
            vec![
                (lb_pair.token_x_mint, AccountsType::TransferHookX),
                (lb_pair.token_y_mint, AccountsType::TransferHookY),
            ]
        }
        ActionType::Reward(idx) => {
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
