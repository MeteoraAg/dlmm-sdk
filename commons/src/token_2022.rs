use crate::*;
use anchor_client::solana_client::nonblocking::rpc_client::RpcClient;
use anchor_client::solana_client::rpc_client::RpcClient as BlockingRpcClient;
use anchor_spl::token_2022::spl_token_2022::extension;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::*;
use anchor_spl::{token::spl_token, token_2022::spl_token_2022::extension::*};
use solana_sdk::account::Account;
use solana_sdk::{instruction::AccountMeta, pubkey::Pubkey};
use spl_transfer_hook_interface::offchain::add_extra_account_metas_for_execute;

const ONE_IN_BASIS_POINTS: u128 = MAX_FEE_BASIS_POINTS as u128;

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

        // Skip 4, source, mint, destination, authority
        let transfer_hook_required_accounts = transfer_ix.accounts[4..].to_vec();
        return Ok(transfer_hook_required_accounts);
    }

    Ok(vec![])
}

pub fn get_epoch_transfer_fee(mint_account: &Account, epoch: u64) -> Result<Option<TransferFee>> {
    if mint_account.owner == spl_token::ID {
        return Ok(None);
    }

    let token_mint_data = mint_account.data.as_ref();
    let token_mint_unpacked = StateWithExtensions::<
        anchor_spl::token_2022::spl_token_2022::state::Mint,
    >::unpack(token_mint_data)?;

    if let std::result::Result::Ok(transfer_fee_config) =
        token_mint_unpacked.get_extension::<extension::transfer_fee::TransferFeeConfig>()
    {
        return Ok(Some(*transfer_fee_config.get_epoch_fee(epoch)));
    }

    Ok(None)
}

#[derive(Debug)]
pub struct TransferFeeExcludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

pub fn calculate_transfer_fee_excluded_amount(
    mint_account: &Account,
    transfer_fee_included_amount: u64,
    epoch: u64,
) -> Result<TransferFeeExcludedAmount> {
    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(mint_account, epoch)? {
        let transfer_fee = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .context("MathOverflow")?;
        let transfer_fee_excluded_amount = transfer_fee_included_amount
            .checked_sub(transfer_fee)
            .context("MathOverflow")?;

        return Ok(TransferFeeExcludedAmount {
            amount: transfer_fee_excluded_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeExcludedAmount {
        amount: transfer_fee_included_amount,
        transfer_fee: 0,
    })
}

#[derive(Debug)]
pub struct TransferFeeIncludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

pub fn calculate_transfer_fee_included_amount(
    mint_account: &Account,
    transfer_fee_excluded_amount: u64,
    epoch: u64,
) -> Result<TransferFeeIncludedAmount> {
    if transfer_fee_excluded_amount == 0 {
        return Ok(TransferFeeIncludedAmount {
            amount: 0,
            transfer_fee: 0,
        });
    }

    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(mint_account, epoch)? {
        let transfer_fee: u64 =
            if u16::from(epoch_transfer_fee.transfer_fee_basis_points) == MAX_FEE_BASIS_POINTS {
                u64::from(epoch_transfer_fee.maximum_fee)
            } else {
                calculate_inverse_fee(&epoch_transfer_fee, transfer_fee_excluded_amount)
                    .context("MathOverflow")?
            };

        let transfer_fee_included_amount = transfer_fee_excluded_amount
            .checked_add(transfer_fee)
            .context("MathOverflow")?;

        return Ok(TransferFeeIncludedAmount {
            amount: transfer_fee_included_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeIncludedAmount {
        amount: transfer_fee_excluded_amount,
        transfer_fee: 0,
    })
}

pub fn calculate_pre_fee_amount(transfer_fee: &TransferFee, post_fee_amount: u64) -> Option<u64> {
    if post_fee_amount == 0 {
        return Some(0);
    }
    let maximum_fee = u64::from(transfer_fee.maximum_fee);
    let transfer_fee_basis_points = u16::from(transfer_fee.transfer_fee_basis_points) as u128;
    if transfer_fee_basis_points == 0 {
        Some(post_fee_amount)
    } else if transfer_fee_basis_points == ONE_IN_BASIS_POINTS {
        Some(maximum_fee.checked_add(post_fee_amount)?)
    } else {
        let numerator = (post_fee_amount as u128).checked_mul(ONE_IN_BASIS_POINTS)?;
        let denominator = ONE_IN_BASIS_POINTS.checked_sub(transfer_fee_basis_points)?;
        let raw_pre_fee_amount = numerator
            .checked_add(denominator)?
            .checked_sub(1)?
            .checked_div(denominator)?;

        if raw_pre_fee_amount.checked_sub(post_fee_amount as u128)? >= maximum_fee as u128 {
            post_fee_amount.checked_add(maximum_fee)
        } else {
            u64::try_from(raw_pre_fee_amount).ok()
        }
    }
}

pub fn calculate_inverse_fee(transfer_fee: &TransferFee, post_fee_amount: u64) -> Option<u64> {
    let pre_fee_amount = calculate_pre_fee_amount(transfer_fee, post_fee_amount)?;
    transfer_fee.calculate_fee(pre_fee_amount)
}
