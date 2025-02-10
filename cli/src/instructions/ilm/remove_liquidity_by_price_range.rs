use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;
use instructions::*;

#[derive(Debug, Parser)]
pub struct RemoveLiquidityByPriceRangeParameters {
    /// Address of the pair
    pub lb_pair: Pubkey,
    // base position path
    pub base_position_key: Pubkey,
    /// min price
    pub min_price: f64,
    /// max price
    pub max_price: f64,
}

pub async fn execute_remove_liquidity_by_price_range<C: Deref<Target = impl Signer> + Clone>(
    params: RemoveLiquidityByPriceRangeParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<()> {
    let RemoveLiquidityByPriceRangeParameters {
        lb_pair,
        base_position_key,
        min_price,
        max_price,
    } = params;

    let rpc_client = program.async_rpc();

    let lb_pair_state = rpc_client
        .get_account_and_deserialize(&lb_pair, |account| {
            Ok(LbPairAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let bin_step = lb_pair_state.bin_step;
    let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

    let mut accounts = rpc_client
        .get_multiple_accounts(&[lb_pair_state.token_x_mint, lb_pair_state.token_y_mint])
        .await?;

    let token_mint_base_account = accounts[0].take().context("token_mint_base not found")?;
    let token_mint_quote_account = accounts[1].take().context("token_mint_quote not found")?;

    let token_mint_base = Mint::try_deserialize(&mut token_mint_base_account.data.as_ref())?;
    let token_mint_quote = Mint::try_deserialize(&mut token_mint_quote_account.data.as_ref())?;

    let min_price_per_lamport = price_per_token_to_per_lamport(
        min_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let min_active_id = get_id_from_price(bin_step, &min_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let max_price_per_lamport = price_per_token_to_per_lamport(
        max_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let max_active_id = get_id_from_price(bin_step, &max_price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    assert!(min_active_id < max_active_id);

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_x_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        lb_pair_state.token_y_mint,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);
    let bin_array_bitmap_extension = rpc_client
        .get_account(&bin_array_bitmap_extension)
        .await
        .map(|_| bin_array_bitmap_extension)
        .unwrap_or(dlmm_interface::ID);

    let width = DEFAULT_BIN_PER_POSITION as i32;

    let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
    let mut transfer_hook_remaining_accounts = vec![];

    if let Some((slices, remaining_accounts)) =
        get_potential_token_2022_related_ix_data_and_accounts(
            &lb_pair_state,
            program.async_rpc(),
            ActionType::Liquidity,
        )
        .await?
    {
        remaining_accounts_info.slices = slices;
        transfer_hook_remaining_accounts.extend(remaining_accounts);
    };

    for i in min_active_id..=max_active_id {
        let (position, _bump) = derive_position_pda(lb_pair, base_position_key, i, width);

        let position_account = rpc_client.get_account(&position).await;
        if let std::result::Result::Ok(account) = position_account {
            let position_state = PositionV2Account::deserialize(account.data.as_ref())?.0;

            let bin_arrays_account_meta = position_state.get_bin_array_accounts_meta_coverage()?;

            let remaining_accounts = [
                transfer_hook_remaining_accounts.clone(),
                bin_arrays_account_meta,
            ]
            .concat();

            let mut instructions =
                vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

            let main_accounts: [AccountMeta; REMOVE_LIQUIDITY_BY_RANGE2_IX_ACCOUNTS_LEN] =
                RemoveLiquidityByRange2Keys {
                    position,
                    lb_pair,
                    bin_array_bitmap_extension,
                    user_token_x,
                    user_token_y,
                    reserve_x: lb_pair_state.reserve_x,
                    reserve_y: lb_pair_state.reserve_y,
                    token_x_mint: lb_pair_state.token_x_mint,
                    token_y_mint: lb_pair_state.token_y_mint,
                    sender: program.payer(),
                    token_x_program,
                    token_y_program,
                    memo_program: spl_memo::ID,
                    event_authority,
                    program: dlmm_interface::ID,
                }
                .into();

            let data = RemoveLiquidityByRange2IxData(RemoveLiquidityByRange2IxArgs {
                from_bin_id: position_state.lower_bin_id,
                to_bin_id: position_state.upper_bin_id,
                bps_to_remove: BASIS_POINT_MAX as u16,
                remaining_accounts_info: remaining_accounts_info.clone(),
            })
            .try_to_vec()?;

            let accounts = [main_accounts.to_vec(), remaining_accounts.clone()].concat();

            let withdraw_all_ix = Instruction {
                program_id: dlmm_interface::ID,
                accounts,
                data,
            };

            instructions.push(withdraw_all_ix);

            let main_accounts: [AccountMeta; CLAIM_FEE2_IX_ACCOUNTS_LEN] = ClaimFee2Keys {
                lb_pair,
                position,
                sender: program.payer(),
                reserve_x: lb_pair_state.reserve_x,
                reserve_y: lb_pair_state.reserve_y,
                token_x_mint: lb_pair_state.token_x_mint,
                token_y_mint: lb_pair_state.token_y_mint,
                token_program_x: token_x_program,
                token_program_y: token_y_program,
                memo_program: spl_memo::ID,
                event_authority,
                program: dlmm_interface::ID,
                user_token_x,
                user_token_y,
            }
            .into();

            let data = ClaimFee2IxData(ClaimFee2IxArgs {
                min_bin_id: position_state.lower_bin_id,
                max_bin_id: position_state.upper_bin_id,
                remaining_accounts_info: remaining_accounts_info.clone(),
            })
            .try_to_vec()?;

            let accounts = [main_accounts.to_vec(), remaining_accounts.clone()].concat();

            let claim_fee_ix = Instruction {
                program_id: dlmm_interface::ID,
                accounts,
                data,
            };

            instructions.push(claim_fee_ix);

            let accounts: [AccountMeta; CLOSE_POSITION2_IX_ACCOUNTS_LEN] = ClosePosition2Keys {
                position,
                sender: program.payer(),
                rent_receiver: program.payer(),
                event_authority,
                program: dlmm_interface::ID,
            }
            .into();

            let data = ClosePosition2IxData.try_to_vec()?;

            let close_position_ix = Instruction {
                program_id: dlmm_interface::ID,
                accounts: accounts.to_vec(),
                data,
            };

            instructions.push(close_position_ix);

            println!(
                "Close position {}. Min bin id {}, Max bin id {}",
                position, position_state.lower_bin_id, position_state.upper_bin_id
            );
        }
    }
    Ok(())
}
