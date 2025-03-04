use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;

#[derive(Debug, Parser)]
pub struct InitLbPair2Params {
    /// Preset parameter pubkey. Get the pubkey from list_all_binstep command.
    pub preset_parameter: Pubkey,
    /// Token X mint of the liquidity pair. Eg: BTC. This should be the base token.
    pub token_mint_x: Pubkey,
    /// Token Y mint of the liquidity pair. Eg: USDC. This should be the quote token.
    pub token_mint_y: Pubkey,
    /// The initial price of the liquidity pair. Eg: 24123.12312412 USDC per 1 BTC.
    pub initial_price: f64,
}

pub async fn execute_initialize_lb_pair2<C: Deref<Target = impl Signer> + Clone>(
    params: InitLbPair2Params,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitLbPair2Params {
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
            Ok(PresetParameter2Account::deserialize(&account.data)?.0)
        })
        .await?;

    let bin_step = preset_parameter_state.bin_step;

    let computed_active_id = get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let (lb_pair, _bump) =
        derive_lb_pair_with_preset_parameter_key(preset_parameter, token_mint_x, token_mint_y);

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();
    let (token_badge_x, _bump) = derive_token_badge_pda(token_mint_x);
    let (token_badge_y, _bump) = derive_token_badge_pda(token_mint_y);

    let accounts = rpc_client
        .get_multiple_accounts(&[token_badge_x, token_badge_y])
        .await?;

    let token_badge_x = accounts[0]
        .as_ref()
        .map(|_| token_badge_x)
        .unwrap_or(dlmm_interface::ID);

    let token_badge_y = accounts[1]
        .as_ref()
        .map(|_| token_badge_y)
        .unwrap_or(dlmm_interface::ID);

    let accounts: [AccountMeta; INITIALIZE_LB_PAIR2_IX_ACCOUNTS_LEN] = InitializeLbPair2Keys {
        lb_pair,
        bin_array_bitmap_extension: dlmm_interface::ID,
        reserve_x,
        reserve_y,
        token_mint_x,
        token_mint_y,
        oracle,
        funder: program.payer(),
        token_badge_x,
        token_badge_y,
        token_program_x: token_mint_base_account.owner,
        token_program_y: token_mint_quote_account.owner,
        preset_parameter,
        system_program: solana_sdk::system_program::ID,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let data = InitializeLbPair2IxData(InitializeLbPair2IxArgs {
        params: InitializeLbPair2Params {
            active_id: computed_active_id,
            padding: [0u8; 96],
        },
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

    println!("Initialize LB pair2 {lb_pair}. Signature: {signature:#?}");

    signature?;

    Ok(lb_pair)
}
