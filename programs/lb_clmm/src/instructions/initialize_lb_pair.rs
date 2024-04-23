use crate::constants::DEFAULT_OBSERVATION_LENGTH;
use crate::errors::LBError;
use crate::events::LbPairCreate;
use crate::state::bin::BinArray;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::lb_pair::LbPair;
use crate::state::lb_pair::PairType;
use crate::state::oracle::Oracle;
use crate::state::oracle::OracleContentLoader;
use crate::state::preset_parameters::PresetParameter;
use crate::state::PairStatus;
use crate::utils::seeds::BIN_ARRAY_BITMAP_SEED;
use crate::utils::seeds::ORACLE;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use std::cmp::{max, min};

#[event_cpi]
#[derive(Accounts)]
#[instruction(active_id: i32, bin_step: u16)]
pub struct InitializeLbPair<'info> {
    #[account(
        init,
        seeds = [
            min(token_mint_x.key(), token_mint_y.key()).as_ref(),
            max(token_mint_x.key(), token_mint_y.key()).as_ref(),
            &bin_step.to_le_bytes(),
            &preset_parameter.base_factor.to_le_bytes()
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
        constraint = bin_step == preset_parameter.bin_step @ LBError::NonPresetBinStep,
    )]
    pub preset_parameter: Account<'info, PresetParameter>,

    #[account(mut)]
    pub funder: Signer<'info>,

    // #[account(address = Token2022::id())]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(ctx: Context<InitializeLbPair>, active_id: i32, bin_step: u16) -> Result<()> {
    Ok(())
}

pub struct InitializePairKeys {
    pub token_mint_x: Pubkey,
    pub token_mint_y: Pubkey,
    pub reserve_x: Pubkey,
    pub reserve_y: Pubkey,
    pub base: Pubkey,
    pub creator: Pubkey,
}

pub struct InitializePairAccounts<'a, 'info> {
    pub lb_pair: &'a AccountLoader<'info, LbPair>,
    pub oracle: &'a AccountLoader<'info, Oracle>,
    pub bin_array_bitmap_extension: Option<&'a AccountLoader<'info, BinArrayBitmapExtension>>,
}

pub fn handle_initialize_pair<'a, 'info>(
    accounts: InitializePairAccounts<'a, 'info>,
    keys: InitializePairKeys,
    active_id: i32,
    preset_parameter: PresetParameter,
    pair_type: PairType,
    bump: u8,
    lock_duration_in_slot: u64,
) -> Result<()> {
    // Initialization of preset parameter already ensure the min, and max bin id bound
    require!(
        active_id >= preset_parameter.min_bin_id && active_id <= preset_parameter.max_bin_id,
        LBError::InvalidBinId
    );

    let mut lb_pair = accounts.lb_pair.load_init()?;

    lb_pair.initialize(
        bump,
        active_id,
        preset_parameter.bin_step,
        keys.token_mint_x,
        keys.token_mint_y,
        keys.reserve_x,
        keys.reserve_y,
        accounts.oracle.key(),
        preset_parameter.to_static_parameters(),
        pair_type,
        PairStatus::Enabled.into(),
        keys.base,
        lock_duration_in_slot,
        keys.creator,
    )?;

    // Extra safety check on preset_parameter won't overflow in edge case. Revert pair creation if overflow.
    lb_pair.compute_composition_fee(u64::MAX)?;
    lb_pair.compute_fee(u64::MAX)?;
    lb_pair.compute_fee_from_amount(u64::MAX)?;
    lb_pair.compute_protocol_fee(u64::MAX)?;

    let mut dynamic_oracle = accounts.oracle.load_content_init()?;
    dynamic_oracle.metadata.init();

    let bin_array_index = BinArray::bin_id_to_bin_array_index(active_id)?;

    if lb_pair.is_overflow_default_bin_array_bitmap(bin_array_index) {
        // init bit array bitmap extension
        require!(
            accounts.bin_array_bitmap_extension.is_some(),
            LBError::BitmapExtensionAccountIsNotProvided
        );

        if let Some(bitmap_ext) = accounts.bin_array_bitmap_extension {
            bitmap_ext.load_init()?.initialize(accounts.lb_pair.key());
        }
    }
    Ok(())
}
