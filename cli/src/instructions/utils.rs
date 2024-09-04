use anchor_client::solana_client::nonblocking::rpc_client::RpcClient;
use anchor_client::solana_client::rpc_client::RpcClient as BlockingRpcClient;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::AccountMeta;
use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_client::solana_sdk::signer::Signer;
use anchor_client::Program;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token_2022::spl_token_2022::extension::{transfer_hook, StateWithExtensions};
use anyhow::*;
use lb_clmm::state::bin::BinArray;
use lb_clmm::state::position::Position;
use lb_clmm::utils::pda::derive_bin_array_pda;
use spl_associated_token_account::instruction::create_associated_token_account;
use spl_transfer_hook_interface::offchain::resolve_extra_account_metas;
use std::ops::Deref;

pub async fn get_or_create_ata<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    token_mint: Pubkey,
    wallet_address: Pubkey,
    token_program: Pubkey,
) -> Result<Pubkey> {
    let user_ata = get_associated_token_address(&wallet_address, &token_mint);

    let rpc_client = program.rpc();
    let user_ata_exists = rpc_client.get_account(&user_ata).is_ok();

    match user_ata_exists {
        true => Ok(user_ata),
        false => {
            let builder = program
                .request()
                .instruction(create_associated_token_account(
                    &program.payer(),
                    &wallet_address,
                    &token_mint,
                    &token_program,
                ));

            builder
                .send_with_spinner_and_config(transaction_config)
                .await?;
            Ok(user_ata)
        }
    }
}

pub async fn get_bin_arrays_for_position<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    position_address: Pubkey,
) -> Result<[Pubkey; 2]> {
    let position: Position = program.account(position_address).await?;

    let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(position.lower_bin_id)?;
    let upper_bin_array_idx = lower_bin_array_idx.checked_add(1).context("MathOverflow")?;

    let (lower_bin_array, _bump) =
        derive_bin_array_pda(position.lb_pair, lower_bin_array_idx.into());
    let (upper_bin_array, _bump) =
        derive_bin_array_pda(position.lb_pair, upper_bin_array_idx.into());

    Ok([lower_bin_array, upper_bin_array])
}

pub fn get_bin_array_account_meta_by_bin_range(
    lb_pair: Pubkey,
    lower_bin_id: i32,
    upper_bin_id: i32,
) -> Result<Vec<AccountMeta>> {
    let mut bin_array_index = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
    let mut bin_arrays = vec![];
    loop {
        let (bin_array, _bump) = derive_bin_array_pda(lb_pair, bin_array_index.into());
        bin_arrays.push(bin_array);

        let (bin_array_lower_bound, bin_array_upper_bound) =
            BinArray::get_bin_array_lower_upper_bin_id(bin_array_index)?;

        if upper_bin_id >= bin_array_lower_bound && upper_bin_id <= bin_array_upper_bound {
            break;
        } else {
            bin_array_index += 1;
        }
    }

    Ok(bin_arrays
        .into_iter()
        .map(|key| AccountMeta::new(key, false))
        .collect())
}

pub async fn get_extra_account_metas_for_transfer_hook(
    mint: Pubkey,
    rpc_client: RpcClient,
) -> Result<Vec<AccountMeta>> {
    let mint_account = rpc_client.get_account(&mint).await?;
    if mint_account.owner.eq(&anchor_spl::token::ID) {
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

        resolve_extra_account_metas(
            &mut transfer_ix,
            data_fetcher,
            &mint,
            &transfer_hook_program_id,
        )
        .await
        .map_err(|e| anyhow!(e))?;

        // Skip 0 -> 4, source, mint, destination, authority
        let transfer_hook_required_accounts = transfer_ix.accounts[5..].to_vec();
        return Ok(transfer_hook_required_accounts);
    }

    Ok(vec![])
}
