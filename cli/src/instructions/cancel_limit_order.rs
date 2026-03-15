use std::collections::BTreeSet;

use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use commons::dlmm::accounts::{BinArray, LbPair};

use crate::*;

#[derive(Debug, Parser)]
pub struct CancelLimitOrderParams {
    /// Address of the lb pair
    #[clap(long)]
    pub lb_pair: Pubkey,
    /// Address of the limit order account
    #[clap(long)]
    pub limit_order: Pubkey,
    /// Bin IDs to cancel
    #[clap(long, num_args = 1..)]
    pub bins: Vec<i32>,
}

pub async fn execute_cancel_limit_order<C: Deref<Target = impl Signer> + Clone>(
    params: CancelLimitOrderParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let CancelLimitOrderParams {
        lb_pair,
        limit_order,
        bins,
    } = params;

    let rpc_client = program.rpc();
    let lb_pair_state: LbPair = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            pod_read_unaligned_skip_disc(&account.data)
        })
        .await?;

    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let owner_token_x = get_associated_token_address_with_program_id(
        &program.payer(),
        &lb_pair_state.token_x_mint,
        &token_x_program,
    );

    let owner_token_y = get_associated_token_address_with_program_id(
        &program.payer(),
        &lb_pair_state.token_y_mint,
        &token_y_program,
    );

    let bitmap_extension_key = derive_bin_array_bitmap_extension(lb_pair).0;
    let bin_array_bitmap_extension = rpc_client
        .get_account(&bitmap_extension_key)
        .await
        .ok()
        .map(|_| bitmap_extension_key)
        .or(Some(dlmm::ID));

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::CancelLimitOrder {
        lb_pair,
        bin_array_bitmap_extension,
        reserve_x: lb_pair_state.reserve_x,
        reserve_y: lb_pair_state.reserve_y,
        token_x_mint: lb_pair_state.token_x_mint,
        token_y_mint: lb_pair_state.token_y_mint,
        limit_order,
        owner_token_x,
        owner_token_y,
        owner: program.payer(),
        token_x_program,
        token_y_program,
        memo_program: spl_memo::ID,
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut remaining_accounts = vec![];

    if let Some((slices, transfer_hook_remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.rpc(),
            ActionType::Liquidity,
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        remaining_accounts.extend(transfer_hook_remaining_accounts);
    };

    let bin_array_indexes: BTreeSet<i64> = bins
        .iter()
        .map(|id| BinArray::bin_id_to_bin_array_index(*id).map(|idx| idx as i64))
        .collect::<Result<_>>()?;

    remaining_accounts.extend(bin_array_indexes.iter().map(|&idx| {
        let (bin_array, _) = derive_bin_array_pda(lb_pair, idx);
        AccountMeta::new(bin_array, false)
    }));

    let data = dlmm::client::args::CancelLimitOrder {
        bins,
        remaining_accounts_info,
    }
    .data();

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let cancel_limit_order_ix = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(cancel_limit_order_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Cancel limit order. Signature: {signature:#?}");

    signature?;

    Ok(())
}
