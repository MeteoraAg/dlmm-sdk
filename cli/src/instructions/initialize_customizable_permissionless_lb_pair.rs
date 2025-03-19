use crate::*;
use anchor_lang::AccountDeserialize;
use anchor_spl::token_interface::Mint;
use instructions::*;

#[derive(Debug, Parser)]
pub struct InitCustomizablePermissionlessLbPairParam {
    /// Token X address
    #[clap(long)]
    pub token_mint_x: Pubkey,
    /// Token Y address
    #[clap(long)]
    pub token_mint_y: Pubkey,
    /// Bin step
    #[clap(long)]
    pub bin_step: u16,
    /// Pool starting price
    #[clap(long)]
    pub initial_price: f64,
    /// Base fee rate
    #[clap(long)]
    pub base_fee_bps: u16,
    /// Pool activation (start trading) type. 0 = Slot based, 1 = Timestamp based
    #[clap(long)]
    pub activation_type: u8,
    /// Indicate whether the launch pool have alpha vault
    #[clap(long)]
    pub has_alpha_vault: bool,
    /// Initial price rounding
    #[clap(long)]
    pub selective_rounding: SelectiveRounding,
    /// Indicate whether the launch pool creator can enable/disable pool
    #[clap(long)]
    pub creator_pool_on_off_control: bool,
    /// Pool activation point. None = Now
    #[clap(long)]
    pub activation_point: Option<u64>,
}

pub async fn execute_initialize_customizable_permissionless_lb_pair<
    C: Deref<Target = impl Signer> + Clone,
>(
    params: InitCustomizablePermissionlessLbPairParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>,
) -> Result<Pubkey> {
    let InitCustomizablePermissionlessLbPairParam {
        bin_step,
        token_mint_x,
        token_mint_y,
        initial_price,
        base_fee_bps,
        activation_type,
        activation_point,
        has_alpha_vault,
        selective_rounding,
        creator_pool_on_off_control,
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

    let computed_active_id = match selective_rounding {
        SelectiveRounding::None => get_precise_id_from_price(bin_step, &price_per_lamport)
            .context("fail to get exact bin id for the price"),
        SelectiveRounding::Down => get_id_from_price(bin_step, &price_per_lamport, Rounding::Down)
            .context("get_id_from_price overflow"),
        SelectiveRounding::Up => get_id_from_price(bin_step, &price_per_lamport, Rounding::Up)
            .context("get_id_from_price overflow"),
    }?;

    let (lb_pair, _bump) = derive_customizable_permissionless_lb_pair(token_mint_x, token_mint_y);

    if program.rpc().get_account_data(&lb_pair).is_ok() {
        return Ok(lb_pair);
    }

    let (reserve_x, _bump) = derive_reserve_pda(token_mint_x, lb_pair);
    let (reserve_y, _bump) = derive_reserve_pda(token_mint_y, lb_pair);
    let (oracle, _bump) = derive_oracle_pda(lb_pair);

    let (event_authority, _bump) = derive_event_authority_pda();

    let user_token_x = get_or_create_ata(
        program,
        transaction_config,
        token_mint_x,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let user_token_y = get_or_create_ata(
        program,
        transaction_config,
        token_mint_y,
        program.payer(),
        compute_unit_price.clone(),
    )
    .await?;

    let accounts: [AccountMeta; INITIALIZE_CUSTOMIZABLE_PERMISSIONLESS_LB_PAIR_IX_ACCOUNTS_LEN] =
        InitializeCustomizablePermissionlessLbPairKeys {
            lb_pair,
            bin_array_bitmap_extension: dlmm_interface::ID,
            reserve_x,
            reserve_y,
            token_mint_x,
            token_mint_y,
            oracle,
            funder: program.payer(),
            system_program: solana_sdk::system_program::ID,
            token_program: token_mint_base_account.owner,
            event_authority,
            user_token_x,
            user_token_y,
            program: dlmm_interface::ID,
        }
        .into();

    let (base_factor, base_fee_power_factor) =
        compute_base_factor_from_fee_bps(bin_step, base_fee_bps)?;

    let data = InitializeCustomizablePermissionlessLbPairIxData(
        InitializeCustomizablePermissionlessLbPairIxArgs {
            params: CustomizableParams {
                active_id: computed_active_id,
                bin_step,
                base_factor,
                activation_type,
                activation_point,
                has_alpha_vault,
                base_fee_power_factor,
                creator_pool_on_off_control,
                padding: [0u8; 62],
            },
        },
    )
    .try_to_vec()?;

    let init_pair_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(init_pair_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize Customizable LB pair {lb_pair}. Signature: {signature:#?}");

    signature?;

    println!("{lb_pair}");

    Ok(lb_pair)
}
