use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;

#[derive(Debug, Parser)]
pub struct InitPermissionLbPairParameters {
    /// Bin step of the liquidity pair. It decide the bps when between bins.
    pub bin_step: u16,
    /// Token X mint of the liquidity pair. Eg: BTC. This should be the base token.
    pub token_mint_x: Pubkey,
    /// Token Y mint of the liquidity pair. Eg: USDC. This should be the quote token.
    pub token_mint_y: Pubkey,
    /// The initial price of the liquidity pair. Eg: 24123.12312412 USDC per 1 BTC.
    pub initial_price: f64,
    /// Base keypair path
    pub base_keypair_path: String,
    /// Base fee bps
    pub base_fee_bps: u16,
    /// Activation type
    pub activation_type: u8,
}

pub async fn execute_initialize_permission_lb_pair<C: Deref<Target = impl Signer> + Clone>(
    params: InitPermissionLbPairParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPermissionLbPairParameters {
        bin_step,
        token_mint_x,
        token_mint_y,
        initial_price,
        base_keypair_path,
        base_fee_bps,
        activation_type,
    } = params;

    let base_keypair = read_keypair_file(base_keypair_path).expect("base keypair file not found");

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

    let computed_active_id = get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
        .context("get_id_from_price overflow")?;

    let (lb_pair, _bump) =
        derive_permission_lb_pair_pda(base_keypair.pubkey(), token_mint_x, token_mint_y, bin_step);

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

    let accounts: [AccountMeta; INITIALIZE_PERMISSION_LB_PAIR_IX_ACCOUNTS_LEN] =
        InitializePermissionLbPairKeys {
            lb_pair,
            bin_array_bitmap_extension: dlmm_interface::ID,
            reserve_x,
            reserve_y,
            token_mint_x,
            token_mint_y,
            token_badge_x,
            token_badge_y,
            token_program_x: token_mint_base_account.owner,
            token_program_y: token_mint_quote_account.owner,
            oracle,
            admin: program.payer(),
            rent: solana_sdk::sysvar::rent::ID,
            system_program: solana_sdk::system_program::ID,
            event_authority,
            program: dlmm_interface::ID,
            base: base_keypair.pubkey(),
        }
        .into();

    let (base_factor, base_fee_power_factor) =
        compute_base_factor_from_fee_bps(bin_step, base_fee_bps)?;

    let data = InitializePermissionLbPairIxData(InitializePermissionLbPairIxArgs {
        ix_data: InitPermissionPairIx {
            active_id: computed_active_id,
            bin_step,
            base_factor,
            activation_type,
            base_fee_power_factor,
            protocol_share: ILM_PROTOCOL_SHARE,
        },
    })
    .try_to_vec()?;

    let init_pair_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(init_pair_ix)
        .signer(&base_keypair)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize Permission LB pair {lb_pair}. Signature: {signature:#?}");

    signature?;

    println!("{lb_pair}");

    Ok(lb_pair)
}
