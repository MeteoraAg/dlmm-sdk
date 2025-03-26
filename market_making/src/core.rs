use crate::MarketMakingMode;
use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::Mint;
use anchor_spl::token_interface::TokenAccount;
use compute_budget::ComputeBudgetInstruction;
use instruction::AccountMeta;
use instruction::Instruction;
use itertools::Itertools;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::Mutex;

pub struct Core {
    pub provider: Cluster,
    pub wallet: Option<Arc<Keypair>>,
    pub owner: Pubkey,
    pub config: Vec<PairConfig>,
    pub state: Arc<Mutex<AllPosition>>,
}

impl Core {
    fn rpc_client(&self) -> RpcClient {
        RpcClient::new(self.provider.url().to_owned())
    }

    pub async fn refresh_state(&self) -> Result<()> {
        let rpc_client = self.rpc_client();

        for pair in self.config.iter() {
            let pair_address =
                Pubkey::from_str(&pair.pair_address).context("Invalid pair address")?;

            let lb_pair_state = rpc_client
                .get_account_and_deserialize(&pair_address, |account| {
                    Ok(LbPairAccount::deserialize(&account.data)?.0)
                })
                .await?;

            // get all position with an user
            let position_accounts = rpc_client
                .get_program_accounts_with_config(
                    &dlmm_interface::ID,
                    RpcProgramAccountsConfig {
                        filters: Some(position_filter_by_wallet_and_pair(self.owner, pair_address)),
                        account_config: RpcAccountInfoConfig {
                            encoding: Some(UiAccountEncoding::Base64),
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                )
                .await?;

            let mut position_key_with_state = position_accounts
                .into_iter()
                .filter_map(|(key, account)| {
                    let position = PositionV2Account::deserialize(&account.data).ok()?.0;
                    Some((key, position))
                })
                .collect::<Vec<_>>();

            let mut position_pks = vec![];
            let mut positions = vec![];
            let mut min_bin_id = 0;
            let mut max_bin_id = 0;
            let mut bin_arrays = HashMap::new();

            if position_key_with_state.len() > 0 {
                // sort position by bin id
                position_key_with_state
                    .sort_by(|(_, a), (_, b)| a.lower_bin_id.cmp(&b.lower_bin_id));

                min_bin_id = position_key_with_state
                    .first()
                    .map(|(_key, state)| state.lower_bin_id)
                    .context("Missing min bin id")?;

                max_bin_id = position_key_with_state
                    .last()
                    .map(|(_key, state)| state.upper_bin_id)
                    .context("Missing max bin id")?;

                for (key, state) in position_key_with_state.iter() {
                    position_pks.push(*key);
                    positions.push(state.to_owned());
                }

                let bin_array_keys = position_key_with_state
                    .iter()
                    .filter_map(|(_key, state)| state.get_bin_array_keys_coverage().ok())
                    .flatten()
                    .unique()
                    .collect::<Vec<_>>();

                let bin_array_accounts = rpc_client.get_multiple_accounts(&bin_array_keys).await?;

                for (key, account) in bin_array_keys.iter().zip(bin_array_accounts) {
                    if let Some(account) = account {
                        let bin_array_state = BinArrayAccount::deserialize(&account.data)?.0;
                        bin_arrays.insert(*key, bin_array_state);
                    }
                }
            }

            let mut all_state = self.state.lock().unwrap();
            let state = all_state.all_positions.get_mut(&pair_address).unwrap();

            state.lb_pair_state = Some(lb_pair_state);
            state.bin_arrays = bin_arrays;
            state.position_pks = position_pks;
            state.positions = positions;
            state.min_bin_id = min_bin_id;
            state.max_bin_id = max_bin_id;
            state.last_update_timestamp = get_epoch_sec();
        }

        Ok(())
    }

    pub async fn fetch_token_info(&self) -> Result<()> {
        let token_mints_with_program = self.get_all_token_mints_with_program_id()?;

        let token_mint_keys = token_mints_with_program
            .iter()
            .map(|(key, _program_id)| *key)
            .collect::<Vec<_>>();

        let rpc_client = self.rpc_client();

        let accounts = rpc_client.get_multiple_accounts(&token_mint_keys).await?;
        let mut tokens = HashMap::new();

        for ((key, program_id), account) in token_mints_with_program.iter().zip(accounts) {
            if let Some(account) = account {
                let mint = Mint::try_deserialize(&mut account.data.as_ref())?;
                tokens.insert(*key, (mint, *program_id));
            }
        }
        let mut state = self.state.lock().unwrap();
        state.tokens = tokens;

        Ok(())
    }

    fn get_all_token_mints_with_program_id(&self) -> Result<Vec<(Pubkey, Pubkey)>> {
        let state = self.state.lock().unwrap();
        let mut token_mints_with_program = vec![];

        for (_, position) in state.all_positions.iter() {
            let lb_pair = &position.lb_pair_state.context("Missing lb pair state")?;
            let [token_x_program, token_y_program] = lb_pair.get_token_programs()?;
            token_mints_with_program.push((lb_pair.token_x_mint, token_x_program));
            token_mints_with_program.push((lb_pair.token_y_mint, token_y_program));
        }

        token_mints_with_program.sort_unstable();
        token_mints_with_program.dedup();
        Ok(token_mints_with_program)
    }

    pub fn get_position_state(&self, lp_pair: Pubkey) -> SinglePosition {
        let state = self.state.lock().unwrap();
        let position = state.all_positions.get(&lp_pair).unwrap();
        position.clone()
    }

    pub async fn init_user_ata(&self) -> Result<()> {
        if let Some(wallet) = self.wallet.as_ref() {
            let rpc_client = self.rpc_client();
            for (token_mint, program_id) in self.get_all_token_mints_with_program_id()?.iter() {
                get_or_create_ata(
                    &rpc_client,
                    *token_mint,
                    *program_id,
                    wallet.pubkey(),
                    wallet,
                )
                .await?;
            }
        }

        Ok(())
    }

    // withdraw all positions
    pub async fn withdraw(&self, state: &SinglePosition, is_simulation: bool) -> Result<()> {
        if state.position_pks.len() == 0 {
            return Ok(());
        }

        let rpc_client = self.rpc_client();

        let payer = self.wallet.clone().context("Requires keypair")?;

        let (event_authority, _bump) = derive_event_authority_pda();

        let lb_pair = state.lb_pair;
        let lb_pair_state = state.lb_pair_state.context("Missing lb pair state")?;

        let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

        let mut remaining_account_info = RemainingAccountsInfo { slices: vec![] };
        let mut transfer_hook_remaining_accounts = vec![];

        if let Some((slices, remaining_accounts)) =
            get_potential_token_2022_related_ix_data_and_accounts(
                &lb_pair_state,
                RpcClient::new(self.provider.url().to_owned()),
                ActionType::Liquidity,
            )
            .await?
        {
            remaining_account_info.slices = slices;
            transfer_hook_remaining_accounts = remaining_accounts;
        }

        for (i, &position) in state.position_pks.iter().enumerate() {
            let position_state = &state.positions[i];

            let bin_arrays_account_meta = position_state.get_bin_array_accounts_meta_coverage()?;

            let user_token_x = get_associated_token_address_with_program_id(
                &payer.pubkey(),
                &lb_pair_state.token_x_mint,
                &token_x_program,
            );

            let user_token_y = get_associated_token_address_with_program_id(
                &payer.pubkey(),
                &lb_pair_state.token_y_mint,
                &token_y_program,
            );

            let mut instructions =
                vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

            let main_accounts: [AccountMeta; REMOVE_LIQUIDITY2_IX_ACCOUNTS_LEN] =
                RemoveLiquidityByRange2Keys {
                    position,
                    lb_pair,
                    bin_array_bitmap_extension: dlmm_interface::ID,
                    user_token_x,
                    user_token_y,
                    reserve_x: lb_pair_state.reserve_x,
                    reserve_y: lb_pair_state.reserve_y,
                    token_x_mint: lb_pair_state.token_x_mint,
                    token_y_mint: lb_pair_state.token_y_mint,
                    sender: payer.pubkey(),
                    token_x_program,
                    token_y_program,
                    memo_program: spl_memo::ID,
                    event_authority,
                    program: dlmm_interface::ID,
                }
                .into();

            let remaining_accounts = [
                transfer_hook_remaining_accounts.clone(),
                bin_arrays_account_meta.clone(),
            ]
            .concat();

            let data = RemoveLiquidityByRange2IxData(RemoveLiquidityByRange2IxArgs {
                from_bin_id: position_state.lower_bin_id,
                to_bin_id: position_state.upper_bin_id,
                bps_to_remove: BASIS_POINT_MAX as u16,
                remaining_accounts_info: remaining_account_info.clone(),
            })
            .try_to_vec()?;

            let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

            let remove_all_ix = Instruction {
                program_id: dlmm_interface::ID,
                accounts,
                data,
            };

            instructions.push(remove_all_ix);

            let main_accounts: [AccountMeta; CLAIM_FEE2_IX_ACCOUNTS_LEN] = ClaimFee2Keys {
                lb_pair,
                position,
                sender: payer.pubkey(),
                event_authority,
                program: dlmm_interface::ID,
                reserve_x: lb_pair_state.reserve_x,
                reserve_y: lb_pair_state.reserve_y,
                token_x_mint: lb_pair_state.token_x_mint,
                token_y_mint: lb_pair_state.token_y_mint,
                token_program_x: token_x_program,
                token_program_y: token_y_program,
                memo_program: spl_memo::ID,
                user_token_x,
                user_token_y,
            }
            .into();

            let remaining_accounts = [
                transfer_hook_remaining_accounts.clone(),
                bin_arrays_account_meta.clone(),
            ]
            .concat();

            let data = ClaimFee2IxData(ClaimFee2IxArgs {
                min_bin_id: position_state.lower_bin_id,
                max_bin_id: position_state.upper_bin_id,
                remaining_accounts_info: remaining_account_info.clone(),
            })
            .try_to_vec()?;

            let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

            let claim_fee_ix = Instruction {
                program_id: dlmm_interface::ID,
                accounts,
                data,
            };

            instructions.push(claim_fee_ix);

            let accounts: [AccountMeta; CLOSE_POSITION2_IX_ACCOUNTS_LEN] = ClosePosition2Keys {
                position,
                sender: payer.pubkey(),
                rent_receiver: payer.pubkey(),
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

            if is_simulation {
                let response =
                    simulate_transaction(&instructions, &rpc_client, &[], payer.pubkey()).await?;
                println!("{:?}", response);
            } else {
                let signature = send_tx(&instructions, &rpc_client, &[], &payer).await?;
                info!("Close position {position} {signature}");
            }
        }

        Ok(())
    }

    // TODO implement jupiter swap swap
    async fn swap(
        &self,
        state: &SinglePosition,
        amount_in: u64,
        swap_for_y: bool,
        is_simulation: bool,
    ) -> Result<Option<SwapEvent>> {
        let rpc_client = self.rpc_client();

        let lb_pair_state = state.lb_pair_state.context("Missing lb pair state")?;
        let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;
        let lb_pair = state.lb_pair;

        let payer = self.wallet.clone().context("Requires keypair")?;

        let (event_authority, _bump) = derive_event_authority_pda();
        let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);

        let account = rpc_client.get_account(&bin_array_bitmap_extension).await;

        let (bin_array_bitmap_extension, bin_array_bitmap_extension_state) =
            if let std::result::Result::Ok(account) = account {
                let bin_array_bitmap_extension_state =
                    BinArrayBitmapExtensionAccount::deserialize(&account.data)?.0;
                (
                    bin_array_bitmap_extension,
                    Some(bin_array_bitmap_extension_state),
                )
            } else {
                (dlmm_interface::ID, None)
            };

        let bin_arrays_account_meta = get_bin_array_pubkeys_for_swap(
            lb_pair,
            &lb_pair_state,
            bin_array_bitmap_extension_state.as_ref(),
            swap_for_y,
            3,
        )?
        .into_iter()
        .map(|key| AccountMeta::new(key, false))
        .collect::<Vec<_>>();

        let (user_token_in, user_token_out) = if swap_for_y {
            (
                get_associated_token_address_with_program_id(
                    &payer.pubkey(),
                    &lb_pair_state.token_x_mint,
                    &token_x_program,
                ),
                get_associated_token_address_with_program_id(
                    &payer.pubkey(),
                    &lb_pair_state.token_y_mint,
                    &token_y_program,
                ),
            )
        } else {
            (
                get_associated_token_address_with_program_id(
                    &payer.pubkey(),
                    &lb_pair_state.token_y_mint,
                    &token_y_program,
                ),
                get_associated_token_address_with_program_id(
                    &payer.pubkey(),
                    &lb_pair_state.token_x_mint,
                    &token_x_program,
                ),
            )
        };

        let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
        let mut remaining_accounts = vec![];

        if let Some((slices, transfer_hook_remaining_accounts)) =
            get_potential_token_2022_related_ix_data_and_accounts(
                &lb_pair_state,
                RpcClient::new(self.provider.url().to_owned()),
                ActionType::Liquidity,
            )
            .await?
        {
            remaining_accounts_info.slices = slices;
            remaining_accounts.extend(transfer_hook_remaining_accounts);
        }

        remaining_accounts.extend(bin_arrays_account_meta);

        let main_accounts: [AccountMeta; SWAP2_IX_ACCOUNTS_LEN] = Swap2Keys {
            lb_pair,
            bin_array_bitmap_extension,
            reserve_x: lb_pair_state.reserve_x,
            reserve_y: lb_pair_state.reserve_y,
            token_x_mint: lb_pair_state.token_x_mint,
            token_y_mint: lb_pair_state.token_y_mint,
            token_x_program,
            token_y_program,
            user: payer.pubkey(),
            user_token_in,
            user_token_out,
            oracle: lb_pair_state.oracle,
            host_fee_in: dlmm_interface::ID,
            event_authority,
            program: dlmm_interface::ID,
            memo_program: spl_memo::ID,
        }
        .into();

        let data = Swap2IxData(Swap2IxArgs {
            amount_in,
            min_amount_out: state.get_min_out_amount_with_slippage_rate(amount_in, swap_for_y)?,
            remaining_accounts_info,
        })
        .try_to_vec()?;

        let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

        let swap_ix = Instruction {
            program_id: dlmm_interface::ID,
            accounts,
            data,
        };

        let compute_budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(1_400_000);

        let instructions = [compute_budget_ix, swap_ix];

        if is_simulation {
            let response =
                simulate_transaction(&instructions, &rpc_client, &[], payer.pubkey()).await?;
            println!("{:?}", response);
            return Ok(None);
        }

        let signature = send_tx(&instructions, &rpc_client, &[], &payer).await?;
        info!("Swap {amount_in} {swap_for_y} {signature}");

        // TODO should handle if cannot get swap eevent
        let swap_event = parse_swap_event(&rpc_client, signature).await?;

        Ok(Some(swap_event))
    }

    pub async fn deposit(
        &self,
        state: &SinglePosition,
        amount_x: u64,
        amount_y: u64,
        active_id: i32,
        is_simulation: bool,
    ) -> Result<()> {
        let payer = self.wallet.clone().context("Require keypair")?;

        let rpc_client = self.rpc_client();
        let lower_bin_id = active_id - (MAX_BIN_PER_ARRAY as i32).checked_div(2).unwrap();

        let upper_bin_id = lower_bin_id
            .checked_add(MAX_BIN_PER_ARRAY as i32)
            .context("math is overflow")?
            .checked_sub(1)
            .context("math is overflow")?;

        let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(lower_bin_id)?;
        let upper_bin_array_idx = lower_bin_array_idx
            .checked_add(1)
            .context("math is overflow")?;

        let lb_pair = state.lb_pair;

        let (event_authority, _bump) = derive_event_authority_pda();

        let mut instructions = vec![ComputeBudgetInstruction::set_compute_unit_limit(1_400_000)];

        for idx in lower_bin_array_idx..=upper_bin_array_idx {
            // Initialize bin array if not exists
            let (bin_array, _bump) = derive_bin_array_pda(lb_pair, idx.into());

            if rpc_client.get_account_data(&bin_array).await.is_err() {
                let accounts: [AccountMeta; INITIALIZE_BIN_ARRAY_IX_ACCOUNTS_LEN] =
                    InitializeBinArrayKeys {
                        bin_array,
                        funder: payer.pubkey(),
                        lb_pair,
                        system_program: system_program::ID,
                    }
                    .into();

                let data = InitializeBinArrayIxData(InitializeBinArrayIxArgs { index: idx.into() })
                    .try_to_vec()?;

                let instruction = Instruction {
                    program_id: dlmm_interface::ID,
                    accounts: accounts.to_vec(),
                    data,
                };

                instructions.push(instruction)
            }
        }

        let position_kp = Keypair::new();
        let position = position_kp.pubkey();

        let accounts: [AccountMeta; INITIALIZE_POSITION_IX_ACCOUNTS_LEN] = InitializePositionKeys {
            lb_pair,
            payer: payer.pubkey(),
            position,
            owner: payer.pubkey(),
            rent: sysvar::rent::ID,
            system_program: system_program::ID,
            event_authority,
            program: dlmm_interface::ID,
        }
        .into();

        let data = InitializePositionIxData(InitializePositionIxArgs {
            lower_bin_id,
            width: DEFAULT_BIN_PER_POSITION as i32,
        })
        .try_to_vec()?;

        let instruction = Instruction {
            program_id: dlmm_interface::ID,
            accounts: accounts.to_vec(),
            data,
        };

        instructions.push(instruction);

        // TODO implement add liquidity by strategy imbalance
        let (bin_array_bitmap_extension, _bump) = derive_bin_array_bitmap_extension(lb_pair);
        let bin_array_bitmap_extension = rpc_client
            .get_account(&bin_array_bitmap_extension)
            .await
            .map(|_| bin_array_bitmap_extension)
            .unwrap_or(dlmm_interface::ID);

        let (bin_array_lower, _bump) = derive_bin_array_pda(lb_pair, lower_bin_array_idx.into());
        let (bin_array_upper, _bump) = derive_bin_array_pda(lb_pair, upper_bin_array_idx.into());

        let lb_pair_state = state.lb_pair_state.context("Missing lb pair state")?;
        let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

        let user_token_x = get_associated_token_address_with_program_id(
            &payer.pubkey(),
            &lb_pair_state.token_x_mint,
            &token_x_program,
        );

        let user_token_y = get_associated_token_address_with_program_id(
            &payer.pubkey(),
            &lb_pair_state.token_y_mint,
            &token_y_program,
        );

        let mut remaining_accounts_info = RemainingAccountsInfo { slices: vec![] };
        let mut remaining_accounts = vec![];

        if let Some((slices, transfer_hook_remaining_accounts)) =
            get_potential_token_2022_related_ix_data_and_accounts(
                &lb_pair_state,
                RpcClient::new(self.provider.url().to_owned()),
                ActionType::Liquidity,
            )
            .await?
        {
            remaining_accounts_info.slices = slices;
            remaining_accounts.extend(transfer_hook_remaining_accounts);
        }

        remaining_accounts.extend(
            [bin_array_lower, bin_array_upper]
                .into_iter()
                .map(|k| AccountMeta::new(k, false)),
        );

        let main_accounts: [AccountMeta; ADD_LIQUIDITY_BY_STRATEGY2_IX_ACCOUNTS_LEN] =
            AddLiquidityByStrategy2Keys {
                lb_pair,
                position,
                bin_array_bitmap_extension,
                sender: payer.pubkey(),
                event_authority,
                program: dlmm_interface::ID,
                reserve_x: lb_pair_state.reserve_x,
                reserve_y: lb_pair_state.reserve_y,
                token_x_mint: lb_pair_state.token_x_mint,
                token_y_mint: lb_pair_state.token_y_mint,
                user_token_x,
                user_token_y,
                token_x_program,
                token_y_program,
            }
            .into();

        let data = AddLiquidityByStrategy2IxData(AddLiquidityByStrategy2IxArgs {
            liquidity_parameter: LiquidityParameterByStrategy {
                amount_x,
                amount_y,
                active_id: lb_pair_state.active_id,
                max_active_bin_slippage: 3,
                strategy_parameters: StrategyParameters {
                    min_bin_id: lower_bin_id,
                    max_bin_id: upper_bin_id,
                    strategy_type: StrategyType::SpotBalanced,
                    parameteres: [0u8; 64],
                },
            },
            remaining_accounts_info,
        })
        .try_to_vec()?;

        let accounts = [main_accounts.to_vec(), remaining_accounts].concat();

        let instruction = Instruction {
            program_id: dlmm_interface::ID,
            accounts,
            data,
        };

        instructions.push(instruction);

        if is_simulation {
            let simulate_tx = simulate_transaction(
                &instructions,
                &rpc_client,
                &[&position_kp, &payer],
                payer.pubkey(),
            )
            .await?;

            info!("Deposit {amount_x} {amount_y} {position} {:?}", simulate_tx);
        } else {
            let signature = send_tx(&instructions, &rpc_client, &[&position_kp], &payer).await?;
            info!("deposit {amount_x} {amount_y} {position} {signature}");
        }

        Ok(())
    }

    pub async fn get_deposit_amount(
        &self,
        position: &SinglePosition,
        amount_x: u64,
        amount_y: u64,
    ) -> Result<(u64, u64)> {
        let lb_pair_state = position.lb_pair_state.context("Missing lb pair state")?;

        let rpc_client = self.rpc_client();
        let payer = self.wallet.clone().context("Require keypair")?;

        let [token_x_program, token_y_program] = lb_pair_state.get_token_programs()?;

        let user_token_x = get_associated_token_address_with_program_id(
            &payer.pubkey(),
            &lb_pair_state.token_x_mint,
            &token_x_program,
        );

        let user_token_y = get_associated_token_address_with_program_id(
            &payer.pubkey(),
            &lb_pair_state.token_y_mint,
            &token_y_program,
        );

        let mut accounts = rpc_client
            .get_multiple_accounts(&[user_token_x, user_token_y])
            .await?;

        let user_token_x_account = accounts[0].take().context("user_token_x not found")?;
        let user_token_y_account = accounts[1].take().context("user_token_y not found")?;

        let user_token_x_state =
            TokenAccount::try_deserialize(&mut user_token_x_account.data.as_ref())?;
        let user_token_y_state =
            TokenAccount::try_deserialize(&mut user_token_y_account.data.as_ref())?;

        // compare with current balance
        let amount_x = if amount_x > user_token_x_state.amount {
            user_token_x_state.amount
        } else {
            amount_x
        };

        let amount_y = if amount_y > user_token_y_state.amount {
            user_token_y_state.amount
        } else {
            amount_y
        };

        Ok((amount_x, amount_y))
    }

    pub fn get_all_positions(&self) -> Vec<SinglePosition> {
        let state = self.state.lock().unwrap();
        let mut positions = vec![];
        for (_, position) in &state.all_positions {
            positions.push(position.clone());
        }
        positions
    }

    pub fn get_all_tokens(&self) -> HashMap<Pubkey, MintWithProgramId> {
        let state = self.state.lock().unwrap();
        state.tokens.clone()
    }

    pub async fn check_shift_price_range(&self) -> Result<()> {
        let all_positions = self.get_all_positions();
        for position in all_positions.iter() {
            let pair_config = get_pair_config(&self.config, position.lb_pair);
            // check whether out of price range
            let lb_pair_state = &position.lb_pair_state.context("Missing lb pair state")?;
            if pair_config.mode == MarketMakingMode::ModeRight
                && lb_pair_state.active_id > position.max_bin_id
            {
                self.shift_right(&position).await?;
                self.inc_rebalance_time(position.lb_pair);
            }

            if pair_config.mode == MarketMakingMode::ModeLeft
                && lb_pair_state.active_id < position.min_bin_id
            {
                self.shift_left(&position).await?;
                self.inc_rebalance_time(position.lb_pair);
            }

            if pair_config.mode == MarketMakingMode::ModeBoth {
                if lb_pair_state.active_id < position.min_bin_id {
                    self.shift_left(&position).await?;
                    self.inc_rebalance_time(position.lb_pair);
                } else if lb_pair_state.active_id > position.max_bin_id {
                    self.shift_right(&position).await?;
                    self.inc_rebalance_time(position.lb_pair);
                }
            }
        }

        Ok(())
    }

    async fn shift_right(&self, state: &SinglePosition) -> Result<()> {
        let pair_config = get_pair_config(&self.config, state.lb_pair);
        // validate that y amount is zero
        info!("shift right {}", state.lb_pair);
        let position = state.get_positions()?;
        if position.amount_x != 0 {
            return Err(Error::msg("Amount x is not zero"));
        }

        info!("withdraw {}", state.lb_pair);
        // withdraw
        self.withdraw(state, false).await?;

        // buy base
        let amount_y_for_buy = position
            .amount_y
            .checked_div(2)
            .context("math is overflow")?;

        let lb_pair_state = &state.lb_pair_state.context("Missing lb pair state")?;

        let (amount_x, amount_y) = if amount_y_for_buy != 0 {
            info!("swap {}", state.lb_pair);
            let swap_event = self.swap(state, amount_y_for_buy, false, false).await?;
            (
                swap_event.map(|e| e.0.amount_out).unwrap_or_default(),
                position.amount_y - amount_y_for_buy,
            )
        } else {
            (pair_config.x_amount, pair_config.y_amount)
        };

        // deposit again, just test with 1 position only
        info!("deposit {}", state.lb_pair);
        match self
            .deposit(state, amount_x, amount_y, lb_pair_state.active_id, false)
            .await
        {
            Err(_) => {
                self.deposit(state, amount_x, amount_y, lb_pair_state.active_id, true)
                    .await?;
            }
            _ => {}
        }
        info!("refresh state {}", state.lb_pair);
        // fetch positions again
        self.refresh_state().await?;
        Ok(())
    }

    async fn shift_left(&self, state: &SinglePosition) -> Result<()> {
        let pair_config = get_pair_config(&self.config, state.lb_pair);
        info!("shift left {}", state.lb_pair);
        // validate that y amount is zero
        let position = state.get_positions()?;
        if position.amount_y != 0 {
            return Err(Error::msg("Amount y is not zero"));
        }
        info!("withdraw {}", state.lb_pair);
        // withdraw
        self.withdraw(state, false).await?;

        // sell base
        let amount_x_for_sell = position
            .amount_x
            .checked_div(2)
            .context("math is overflow")?;

        let lb_pair_state = &state.lb_pair_state.context("Missing lb pair state")?;

        let (amount_x, amount_y) = if amount_x_for_sell != 0 {
            info!("swap {}", state.lb_pair);
            let swap_event = self.swap(state, amount_x_for_sell, true, false).await?;
            (
                position.amount_x - amount_x_for_sell,
                swap_event.map(|e| e.0.amount_out).unwrap_or_default(),
            )
        } else {
            (pair_config.x_amount, pair_config.y_amount)
        };

        // sanity check with real balances
        let (amount_x, amount_y) = self.get_deposit_amount(state, amount_x, amount_y).await?;
        info!("deposit {}", state.lb_pair);
        match self
            .deposit(state, amount_x, amount_y, lb_pair_state.active_id, false)
            .await
        {
            Err(_) => {
                self.deposit(state, amount_x, amount_y, lb_pair_state.active_id, true)
                    .await?;
            }
            _ => {}
        }

        info!("refresh state {}", state.lb_pair);
        // fetch positions again
        self.refresh_state().await?;
        Ok(())
    }

    pub fn inc_rebalance_time(&self, lb_pair: Pubkey) {
        let mut state = self.state.lock().unwrap();
        let state = state.all_positions.get_mut(&lb_pair).unwrap();
        state.inc_rebalance_time();
    }

    pub fn get_positions(&self) -> Result<Vec<PositionInfo>> {
        let all_positions = self.get_all_positions();
        let tokens = self.get_all_tokens();

        let mut position_infos = vec![];
        for position in all_positions.iter() {
            let lb_pair_state = &position.lb_pair_state.context("Missing lb pair state")?;
            let x_decimals = get_decimals(lb_pair_state.token_x_mint, &tokens);
            let y_decimals = get_decimals(lb_pair_state.token_y_mint, &tokens);
            let position_raw = position.get_positions()?;
            position_infos.push(position_raw.to_position_info(x_decimals, y_decimals)?);
        }
        return Ok(position_infos);
    }
}

#[cfg(test)]
mod core_test {
    use super::*;
    use std::env;

    #[tokio::test]
    async fn test_withdraw() {
        let wallet = env::var("MM_WALLET").unwrap();
        let cluster = env::var("MM_CLUSTER").unwrap();
        let payer = read_keypair_file(wallet.clone()).unwrap();

        let lp_pair = Pubkey::from_str("FoSDw2L5DmTuQTFe55gWPDXf88euaxAEKFre74CnvQbX").unwrap();

        let config = vec![PairConfig {
            pair_address: lp_pair.to_string(),
            x_amount: 17000000,
            y_amount: 2000000,
            mode: MarketMakingMode::ModeBoth,
        }];

        let core = &Core {
            provider: Cluster::from_str(&cluster).unwrap(),
            owner: payer.pubkey(),
            wallet: Some(Arc::new(payer)),
            config: config.clone(),
            state: Arc::new(Mutex::new(AllPosition::new(&config))),
        };

        core.refresh_state().await.unwrap();

        let state = core.get_position_state(lp_pair);

        // withdraw
        core.withdraw(&state, true).await.unwrap();
    }

    #[tokio::test]
    async fn test_swap() {
        let wallet = env::var("MM_WALLET").unwrap();
        let cluster = env::var("MM_CLUSTER").unwrap();
        let payer = read_keypair_file(wallet.clone()).unwrap();

        let lp_pair = Pubkey::from_str("FoSDw2L5DmTuQTFe55gWPDXf88euaxAEKFre74CnvQbX").unwrap();

        let config = vec![PairConfig {
            pair_address: lp_pair.to_string(),
            x_amount: 17000000,
            y_amount: 2000000,
            mode: MarketMakingMode::ModeBoth,
        }];

        let core = &Core {
            provider: Cluster::from_str(&cluster).unwrap(),
            owner: payer.pubkey(),
            wallet: Some(Arc::new(payer)),
            config: config.clone(),
            state: Arc::new(Mutex::new(AllPosition::new(&config))),
        };

        core.refresh_state().await.unwrap();

        let state = core.get_position_state(lp_pair);

        core.swap(&state, 1000000, true, true).await.unwrap();
    }
}
