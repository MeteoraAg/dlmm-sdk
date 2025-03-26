use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;

#[derive(Debug, Parser)]
pub struct InitLbPairParams {
    /// Preset parameter pubkey. Get the pubkey from list_all_binstep command.
    pub preset_parameter: Pubkey,
    /// Token X mint of the liquidity pair. Eg: BTC. This should be the base token.
    pub token_mint_x: Pubkey,
    /// Token Y mint of the liquidity pair. Eg: USDC. This should be the quote token.
    pub token_mint_y: Pubkey,
    /// The initial price of the liquidity pair. Eg: 24123.12312412 USDC per 1 BTC.
    pub initial_price: f64,
}

pub async fn execute_initialize_lb_pair<C: Deref<Target = impl Signer> + Clone>(
    params: InitLbPairParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitLbPairParams {
        preset_parameter,
        token_mint_x,
        token_mint_y,
        initial_price,
    } = params;

    let rpc_client = program.async_rpc();

    let mut accounts = rpc_client
        .get_multiple_accounts(&[token_mint_x, token_mint_y])
        .await?;

    let token_mint_base_account = accounts[0].take().context("token_mint_base not found")?;
    let token_mint_quote_account = accounts[1].take().context("token_mint_quote not found")?;

    let token_mint_base = Mint::try_deserialize(&mut token_mint_base_account.data.as_ref())?;
    let token_mint_quote = Mint::try_deserialize(&mut token_mint_quote_account.data.as_ref())?;

    let price_per_lamport = price_per_token_to_per_lamport(
        initial_price,
        token_mint_base.decimals,
        token_mint_quote.decimals,
    )
    .context("price_per_token_to_per_lamport overflow")?;

    let preset_parameter_state = rpc_client
        .get_account_and_deserialize(&preset_parameter, |account| {
            Ok(PresetParameterAccount::deserialize(&account.data)?.0)
        })
        .await?;

    let bin_step = preset_parameter_state.bin_step;

    let computed_active_id = get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let (lb_pair, _bump) = derive_lb_pair_pda2(
        token_mint_x,
        token_mint_y,
        preset_parameter_state.bin_step,
        preset_parameter_state.base_factor,
    );

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; INITIALIZE_LB_PAIR_IX_ACCOUNTS_LEN] = InitializeLbPairKeys {
        lb_pair,
        bin_array_bitmap_extension: dlmm_interface::ID,
        reserve_x,
        reserve_y,
        token_mint_x,
        token_mint_y,
        oracle,
        funder: program.payer(),
        token_program: token_mint_base_account.owner,
        preset_parameter,
        system_program: solana_sdk::system_program::ID,
        event_authority,
        program: dlmm_interface::ID,
        rent: solana_sdk::sysvar::rent::ID,
    }
    .into();

    let data = InitializeLbPairIxData(InitializeLbPairIxArgs {
        active_id: computed_active_id,
        bin_step,
    })
    .try_to_vec()?;

    let init_pair_ix = Instruction {
        program_id: dlmm_interface::ID,
        data,
        accounts: accounts.to_vec(),
    };

    let request_builder = program.request();

    let signature = request_builder
        .instruction(init_pair_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize LB pair {lb_pair}. Signature: {signature:#?}");

    signature?;

    Ok(lb_pair)
}
