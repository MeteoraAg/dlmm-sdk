use crate::*;
use anchor_spl::token_interface::Mint;

#[derive(Debug, Parser)]
pub struct SyncPriceParams {
    pub lb_pair: Pubkey,
    pub price: f64,
}

pub async fn execute_sync_price<C: Deref<Target = impl Signer> + Clone>(
    params: SyncPriceParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let SyncPriceParams { lb_pair, price } = params;

    let rpc_client = program.rpc();

    let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);

    let lb_pair_state: LbPair = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(bytemuck::pod_read_unaligned(&account.data[8..]))
        })
        .await?;

    let mut accounts = rpc_client
        .get_multiple_accounts(&[
            lb_pair_state.token_x_mint,
            lb_pair_state.token_y_mint,
            bin_array_bitmap_extension,
        ])
        .await?;

    let token_mint_base_account = accounts[0].take().context("token_mint_base not found")?;
    let token_mint_quote_account = accounts[1].take().context("token_mint_quote not found")?;
    let bin_array_bitmap_extension_account = accounts[2].take();

    let token_mint_base = Mint::try_deserialize(&mut token_mint_base_account.data.as_ref())?;
    let token_mint_quote = Mint::try_deserialize(&mut token_mint_quote_account.data.as_ref())?;

    let price_per_lamport =
        price_per_token_to_per_lamport(price, token_mint_base.decimals, token_mint_quote.decimals)
            .context("price_per_token_to_per_lamport overflow")?;

    let computed_active_id =
        get_id_from_price(lb_pair_state.bin_step, &price_per_lamport, Rounding::Up)
            .context("get_id_from_price overflow")?;

    let ix_data = dlmm::client::args::GoToABin {
        bin_id: computed_active_id,
    }
    .data();

    let from_bin_array_idx = BinArray::bin_id_to_bin_array_index(lb_pair_state.active_id)?;
    let to_bin_array_idx = BinArray::bin_id_to_bin_array_index(computed_active_id)?;

    let (from_bin_array, _bump) = derive_bin_array_pda(lb_pair, from_bin_array_idx.into());
    let (to_bin_array, _bump) = derive_bin_array_pda(lb_pair, to_bin_array_idx.into());

    accounts = rpc_client
        .get_multiple_accounts(&[from_bin_array, to_bin_array])
        .await?;

    let from_bin_array_account = accounts[0].take();
    let to_bin_array_account = accounts[1].take();

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = dlmm::client::accounts::GoToABin {
        lb_pair,
        bin_array_bitmap_extension: bin_array_bitmap_extension_account
            .map(|_| bin_array_bitmap_extension)
            .or(Some(dlmm::ID)),
        from_bin_array: from_bin_array_account
            .map(|_| from_bin_array)
            .or(Some(dlmm::ID)),
        to_bin_array: to_bin_array_account
            .map(|_| to_bin_array)
            .or(Some(dlmm::ID)),
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: dlmm::ID,
        accounts,
        data: ix_data,
    };

    let mut ixs = vec![];

    if let Some(compute_unit_price_ix) = compute_unit_price {
        ixs.push(compute_unit_price_ix);
    }

    ixs.push(ix);

    let builder = program.request();
    let builder = ixs
        .into_iter()
        .fold(builder, |builder, ix| builder.instruction(ix));

    let signature = builder
        .send_with_spinner_and_config(transaction_config)
        .await;
    println!("{:#?}", signature);

    signature?;

    Ok(())
}
