use std::collections::BTreeSet;
use std::sync::Arc;

use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use commons::dlmm::accounts::{BinArray, LbPair};
use commons::dlmm::types::PlaceLimitOrderParams as PlaceLimitOrderIxParams;

use crate::*;

#[derive(Debug, Parser)]
pub struct PlaceLimitOrderCliParams {
    /// Address of the lb pair
    #[clap(long)]
    pub lb_pair: Pubkey,
    /// Whether this is an ask (sell X) order. If false, it's a bid (sell Y) order.
    #[clap(long)]
    pub is_ask_side: bool,
    /// Bin ID and amount pairs. Format: bin_id,amount. Can be specified multiple times.
    #[clap(long, value_parser = parse_bin_limit_order, num_args = 1..)]
    pub bins: Vec<(i32, u64)>,
    /// Owner of the limit order (defaults to payer if not specified)
    #[clap(long)]
    pub owner: Option<Pubkey>,
    /// Path to the limit order keypair file
    #[clap(long)]
    pub limit_order_keypair_path: String,
}

pub async fn execute_place_limit_order<C: Deref<Target = impl Signer> + Clone>(
    params: PlaceLimitOrderCliParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let PlaceLimitOrderCliParams {
        lb_pair,
        is_ask_side,
        bins,
        owner,
        limit_order_keypair_path,
    } = params;

    let limit_order_keypair = Arc::new(
        read_keypair_file(&limit_order_keypair_path).expect("limit order keypair file not found"),
    );

    let owner = owner.unwrap_or_else(|| program.payer());

    let rpc_client = program.rpc();
    let lb_pair_state: LbPair = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            pod_read_unaligned_skip_disc(&account.data)
        })
        .await?;

    let (token_mint, reserve) = if is_ask_side {
        (lb_pair_state.token_x_mint, lb_pair_state.reserve_x)
    } else {
        (lb_pair_state.token_y_mint, lb_pair_state.reserve_y)
    };

    let token_mint_account = rpc_client.get_account(&token_mint).await?;
    let token_program = token_mint_account.owner;

    let user_token =
        get_associated_token_address_with_program_id(&program.payer(), &token_mint, &token_program);

    let bitmap_extension_key = derive_bin_array_bitmap_extension(lb_pair).0;
    let bin_array_bitmap_extension = rpc_client
        .get_account(&bitmap_extension_key)
        .await
        .ok()
        .map(|_| bitmap_extension_key)
        .or(Some(dlmm::ID));

    let (event_authority, _bump) = derive_event_authority_pda();

    let main_accounts = dlmm::client::accounts::PlaceLimitOrder {
        lb_pair,
        bin_array_bitmap_extension,
        reserve,
        token_mint,
        limit_order: limit_order_keypair.pubkey(),
        payer: program.payer(),
        owner,
        user_token,
        sender: program.payer(),
        token_program,
        system_program: solana_sdk::system_program::ID,
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
        .map(|(id, _)| BinArray::bin_id_to_bin_array_index(*id).map(|idx| idx as i64))
        .collect::<Result<_>>()?;

    remaining_accounts.extend(bin_array_indexes.iter().map(|&idx| {
        let (bin_array, _) = derive_bin_array_pda(lb_pair, idx);
        AccountMeta::new(bin_array, false)
    }));

    let data = dlmm::client::args::PlaceLimitOrder {
        params: PlaceLimitOrderIxParams {
            is_ask_side,
            padding: [0u8; 16],
            relative_bin: None,
            bins: bins
                .into_iter()
                .map(|(id, amount)| BinLimitOrderAmount { id, amount })
                .collect(),
        },
        remaining_accounts_info,
    }
    .data();

    let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

    let place_limit_order_ix = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(place_limit_order_ix)
        .signer(limit_order_keypair)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Place limit order. Signature: {signature:#?}");

    signature?;

    Ok(())
}
