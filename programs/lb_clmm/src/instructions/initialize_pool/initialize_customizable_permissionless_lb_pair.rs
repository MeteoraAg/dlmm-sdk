use crate::constants::DEFAULT_OBSERVATION_LENGTH;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::lb_pair::LbPair;
use crate::state::oracle::Oracle;
use crate::state::preset_parameters::PresetParameter;
use crate::utils;
use crate::utils::seeds::BIN_ARRAY_BITMAP_SEED;
use crate::utils::seeds::ILM_BASE_KEY;
use crate::utils::seeds::ORACLE;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{Mint, TokenAccount};
use std::cmp::{max, min};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CustomizableParams {
    /// Pool price
    pub active_id: i32,
    /// Bin step
    pub bin_step: u16,
    /// Base factor
    pub base_factor: u16,
    /// Activation type. 0 = Slot, 1 = Time. Check ActivationType enum
    pub activation_type: u8,
    /// Whether the pool has an alpha vault
    pub has_alpha_vault: bool,
    /// Decide when does the pool start trade. None = Now
    pub activation_point: Option<u64>,
    /// Pool creator have permission to enable/disable pool with restricted program validation. Only applicable for customizable permissionless pool.
    pub creator_pool_on_off_control: bool,
    /// Padding, for future use
    pub padding: [u8; 63],
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: CustomizableParams)]
pub struct InitializeCustomizablePermissionlessLbPair<'info> {
    #[account(
        init,
        seeds = [
            ILM_BASE_KEY.as_ref(),
            min(token_mint_x.key(), token_mint_y.key()).as_ref(),
            max(token_mint_x.key(), token_mint_y.key()).as_ref(),
        ],
        bump,
        payer = funder,
        space = 8 + LbPair::INIT_SPACE
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        init,
        seeds = [
            BIN_ARRAY_BITMAP_SEED,
            lb_pair.key().as_ref(),
        ],
        bump,
        payer = funder,
        space = 8 + BinArrayBitmapExtension::INIT_SPACE
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(constraint = token_mint_x.key() != token_mint_y.key())]
    pub token_mint_x: Box<InterfaceAccount<'info, Mint>>,
    pub token_mint_y: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        seeds = [
            lb_pair.key().as_ref(),
            token_mint_x.key().as_ref()
        ],
        bump,
        payer = funder,
        token::mint = token_mint_x,
        token::authority = lb_pair,
    )]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        seeds = [
            lb_pair.key().as_ref(),
            token_mint_y.key().as_ref()
        ],
        bump,
        payer = funder,
        token::mint = token_mint_y,
        token::authority = lb_pair,
    )]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        seeds = [
            ORACLE,
            lb_pair.key().as_ref()
        ],
        bump,
        payer = funder,
        space = Oracle::space(DEFAULT_OBSERVATION_LENGTH)
    )]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(
        token::authority = funder,
        token::mint = token_mint_x,
    )]
    pub user_token_x: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub funder: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: user token Y, only be checked if token_y_mint is not based quote token
    pub user_token_y: UncheckedAccount<'info>,
}

pub fn handle(
    ctx: Context<InitializeCustomizablePermissionlessLbPair>,
    params: CustomizableParams,
) -> Result<()> {
    Ok(())
}
