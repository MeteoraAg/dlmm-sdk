use crate::*;
use instructions::*;

#[derive(Debug, Parser)]
pub struct FundRewardParams {
    pub lb_pair: Pubkey,
    pub reward_index: u64,
    pub funding_amount: u64,
}

pub async fn execute_fund_reward<C: Deref<Target = impl Signer> + Clone>(
    params: FundRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let FundRewardParams {
        lb_pair,
        reward_index,
        funding_amount,
    } = params;

    let rpc_client = program.async_rpc();

    let (reward_vault, _bump) = derive_reward_vault_pda(lb_pair, reward_index);

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let reward_info = lb_pair_state.reward_infos[reward_index as usize];
    let reward_mint = reward_info.mint;

    let reward_mint_program = rpc_client.get_account(&reward_mint).await?.owner;

    let funder_token_account = get_or_create_ata(
        program,
        transaction_config,
        reward_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let active_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id)?;
    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, active_bin_array_idx as i64);

    let (event_authority, _bump) = derive_event_authority_pda();

    let reward_transfer_hook_accounts =
        get_extra_account_metas_for_transfer_hook(reward_mint, program.async_rpc()).await?;

    let remaining_accounts_info = RemainingAccountsInfo {
        slices: vec![RemainingAccountsSlice {
            accounts_type: AccountsType::TransferHookReward,
            length: reward_transfer_hook_accounts.len() as u8,
        }],
    };

    let main_accounts: [AccountMeta; FUND_REWARD_IX_ACCOUNTS_LEN] = FundRewardKeys {
        lb_pair,
        reward_vault,
        reward_mint,
        funder: program.payer(),
        funder_token_account,
        bin_array,
        token_program: reward_mint_program,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let data = FundRewardIxData(FundRewardIxArgs {
        reward_index,
        amount: funding_amount,
        carry_forward: true,
        remaining_accounts_info,
    })
    .try_to_vec()?;

    let accounts = [main_accounts.to_vec(), reward_transfer_hook_accounts].concat();

    let fund_reward_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(fund_reward_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Fund reward. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
