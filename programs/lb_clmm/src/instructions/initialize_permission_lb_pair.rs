use crate::assert_eq_launch_pool_admin;
use crate::constants::DEFAULT_OBSERVATION_LENGTH;
use crate::errors::LBError;
use crate::events::LbPairCreate;
use crate::instructions::initialize_lb_pair::handle_initialize_pair;
use crate::instructions::initialize_lb_pair::InitializePairAccounts;
use crate::instructions::initialize_lb_pair::InitializePairKeys;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::lb_pair::LbPair;
use crate::state::lb_pair::PairType;
use crate::state::oracle::Oracle;
use crate::state::preset_parameters::validate_min_max_bin_id;
use crate::state::preset_parameters::PresetParameter;
use crate::utils::seeds::BIN_ARRAY_BITMAP_SEED;
use crate::utils::seeds::ORACLE;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use std::cmp::{max, min};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitPermissionPairIx {
    pub active_id: i32,
    pub bin_step: u16,
    pub base_factor: u16,
    pub min_bin_id: i32,
    pub max_bin_id: i32,
    pub lock_duration_in_slot: u64,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(ix_data: InitPermissionPairIx)]
pub struct InitializePermissionLbPair<'info> {
    pub base: Signer<'info>,

    #[account(
        init,
        seeds = [
            base.key().as_ref(),
            min(token_mint_x.key(), token_mint_y.key()).as_ref(),
            max(token_mint_x.key(), token_mint_y.key()).as_ref(),
            &ix_data.bin_step.to_le_bytes(),
        ],
        bump,
        payer = admin,
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
        payer = admin,
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
        payer = admin,
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
        payer = admin,
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
        payer = admin,
        space = Oracle::space(DEFAULT_OBSERVATION_LENGTH)
    )]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(
        mut,
        constraint = assert_eq_launch_pool_admin(admin.key()) @ LBError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,

    // #[account(address = Token2022::id())]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle(
    ctx: Context<InitializePermissionLbPair>,
    ix_data: InitPermissionPairIx,
) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PairStatus;
    use num_traits::Zero;
    use proptest::proptest;

    proptest! {
            #[test]
            fn test_preset_parameter_without_variable_fee_configuration(
                bin_step in 1..=10000_u16,
                active_id in i32::MIN..=i32::MAX,
                current_timestamp in 0_i64..=(u16::MAX as i64),
                bin_swapped in 0..=(u16::MAX as i32),
                swap_direction in 0..=1,
                seconds_elapsed in 0_i64..=(u16::MAX as i64)
            ) {
            let preset_parameter = PresetParameter {
                bin_step,
                base_factor: 10000,
                min_bin_id: i32::MIN,
                max_bin_id: i32::MAX,
                ..Default::default()
            };

            let mut lb_pair = LbPair::default();
            assert!(lb_pair
                .initialize(
                    0,
                    active_id,
                    bin_step,
                    Pubkey::new_unique(),
                    Pubkey::new_unique(),
                    Pubkey::new_unique(),
                    Pubkey::new_unique(),
                    Pubkey::new_unique(),
                    preset_parameter.to_static_parameters(),
                    PairType::Permission,
                    PairStatus::Enabled.into(),
                    Pubkey::new_unique(),
                    0,
                    Pubkey::new_unique()
                ).is_ok());

            assert!(lb_pair.update_references(current_timestamp).is_ok());

            let variable_fee_rate = lb_pair.get_variable_fee();
            assert!(variable_fee_rate.is_ok());
            // No variable fee rate
            assert!(variable_fee_rate.unwrap().is_zero());

            let delta = if swap_direction == 0 {
                -bin_swapped
            } else {
                bin_swapped
            };

            lb_pair.active_id += delta;
            assert!(lb_pair.update_volatility_accumulator().is_ok());

            assert!(lb_pair.update_references(current_timestamp + seconds_elapsed).is_ok());

            let variable_fee_rate = lb_pair.get_variable_fee();
            assert!(variable_fee_rate.is_ok());
            // No variable fee rate
            assert!(variable_fee_rate.unwrap().is_zero());
        }
    }
}
