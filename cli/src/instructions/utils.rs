use std::collections::HashMap;

use crate::*;
use anchor_client::solana_client::rpc_client::RpcClient as BlockingRpcClient;
use anchor_client::{
    solana_client::nonblocking::rpc_client::RpcClient, solana_sdk::account::Account,
};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token::spl_token,
    token_2022::spl_token_2022::extension::{transfer_hook, StateWithExtensions},
};
use num_integer::Integer;
use solana_sdk::program_pack::Pack;
use solana_sdk::sysvar::clock::Clock;
use spl_associated_token_account::instruction::create_associated_token_account_idempotent;
use spl_transfer_hook_interface::offchain::add_extra_account_metas_for_execute;

pub fn position_bin_range_chunks(lower_bin_id: i32, upper_bin_id: i32) -> Vec<(i32, i32)> {
    let mut chunked_bin_range = vec![];
    let bin_range = upper_bin_id - lower_bin_id + 1;

    let (quotient, remainder) = bin_range.div_rem(&(DEFAULT_BIN_PER_POSITION as i32));
    let chunk = quotient + (remainder != 0) as i32;

    for i in 0..chunk {
        let min_bin_id = lower_bin_id + DEFAULT_BIN_PER_POSITION as i32 * i;
        let max_bin_id = std::cmp::min(
            min_bin_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
            upper_bin_id,
        );

        chunked_bin_range.push((min_bin_id, max_bin_id));
    }

    chunked_bin_range
}

#[allow(dead_code)]
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
    compute_unit_price: Option<Instruction>,
) -> Result<Pubkey> {
    let rpc_client = program.rpc();
    let token_mint_owner = rpc_client.get_account(&token_mint).await?.owner;

    let user_ata = get_associated_token_address_with_program_id(
        &wallet_address,
        &token_mint,
        &token_mint_owner,
    );
    let user_ata_exists = rpc_client.get_account(&user_ata).await.is_ok();

    if !user_ata_exists {
        let mut builder = program.request();

        if let Some(compute_unit_price) = compute_unit_price {
            builder = builder.instruction(compute_unit_price);
        }

        builder = builder.instruction(create_associated_token_account_idempotent(
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

pub struct SwapQuoteAccounts {
    pub lb_pair_state: LbPair,
    pub clock: Clock,
    pub mint_x_account: Account,
    pub mint_y_account: Account,
    pub bin_arrays: HashMap<Pubkey, BinArray>,
    pub bin_array_keys: Vec<Pubkey>,
}

pub async fn fetch_quote_required_accounts(
    rpc_client: &RpcClient,
    lb_pair: Pubkey,
    lb_pair_state: &LbPair,
    bin_arrays_for_swap: Vec<Pubkey>,
) -> Result<SwapQuoteAccounts> {
    let prerequisite_accounts = [
        lb_pair,
        solana_sdk::sysvar::clock::ID,
        lb_pair_state.token_x_mint,
        lb_pair_state.token_y_mint,
    ];

    let accounts_to_fetch = [prerequisite_accounts.to_vec(), bin_arrays_for_swap.clone()].concat();

    let accounts = rpc_client.get_multiple_accounts(&accounts_to_fetch).await?;

    let mut index = 0;
    let lb_pair_account = accounts
        .get(index)
        .and_then(ToOwned::to_owned)
        .context("Failed to fetch lb pair account")?;
    let lb_pair_state = bytemuck::pod_read_unaligned(&mut lb_pair_account.data[8..].as_ref());

    index.inc();
    let clock_account = accounts
        .get(index)
        .and_then(ToOwned::to_owned)
        .context("Failed to fetch clock account")?;
    let clock: Clock = bincode::deserialize(clock_account.data.as_ref())?;

    index.inc();
    let mint_x_account = accounts
        .get(index)
        .and_then(ToOwned::to_owned)
        .context("Failed to fetch mint account")?;

    index.inc();
    let mint_y_account = accounts
        .get(index)
        .and_then(ToOwned::to_owned)
        .context("Failed to fetch mint account")?;

    let bin_array_accounts = accounts
        .get(prerequisite_accounts.len()..)
        .context("Failed to fetch bin array accounts")?
        .to_vec();

    let valid_bin_array_accounts = bin_array_accounts
        .into_iter()
        .zip(bin_arrays_for_swap.iter())
        .filter_map(|(account, &key)| {
            let account = account?;
            Some((
                key,
                bytemuck::pod_read_unaligned(&account.data[8..].as_ref()),
            ))
        })
        .collect::<Vec<_>>();

    let bin_arrays = valid_bin_array_accounts
        .clone()
        .into_iter()
        .collect::<HashMap<_, _>>();

    let bin_array_keys = valid_bin_array_accounts
        .into_iter()
        .map(|(key, _)| key)
        .collect::<Vec<_>>();

    Ok(SwapQuoteAccounts {
        lb_pair_state,
        clock,
        mint_x_account,
        mint_y_account,
        bin_arrays,
        bin_array_keys,
    })
}
