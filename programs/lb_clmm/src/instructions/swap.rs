use crate::constants::{HOST_FEE_BPS, MAX_REWARD_BIN_SPLIT, NUM_REWARDS};
use crate::errors::LBError;
use crate::events::Swap as SwapEvent;
use crate::math::safe_math::SafeMath;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::state::action_access::get_lb_pair_type_access_validator;
use crate::state::bin::SwapResult;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::oracle::{Oracle, OracleContentLoader};
use crate::state::{bin::BinArray, lb_pair::*};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::TransferChecked;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use ruint::aliases::U256;
use std::cell::RefMut;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Accounts)]
pub struct BinArrayAccount<'info> {
    #[account(mut)]
    pub bin_array: AccountLoader<'info, BinArray>,
}

impl<'info> BinArrayAccount<'info> {
    pub fn load_and_validate(&self, lb_pair: Pubkey) -> Result<RefMut<'_, BinArray>> {
        let bin_array = self.bin_array.load_mut()?;
        require!(bin_array.lb_pair == lb_pair, LBError::InvalidBinArray);
        Ok(bin_array)
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        mut,
        has_one = reserve_x,
        has_one = reserve_y,
        has_one = token_x_mint,
        has_one = token_y_mint,
        has_one = oracle,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        has_one = lb_pair,
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(mut)]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_token_in.mint != user_token_out.mint @ LBError::InvalidTokenMint,
        constraint = user_token_in.mint == token_x_mint.key() || user_token_in.mint == token_y_mint.key() @ LBError::InvalidTokenMint,
    )]
    pub user_token_in: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = user_token_out.mint == token_x_mint.key() || user_token_out.mint == token_y_mint.key() @ LBError::InvalidTokenMint,
    )]
    pub user_token_out: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub oracle: AccountLoader<'info, Oracle>,

    #[account(mut)]
    pub host_fee_in: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    pub user: Signer<'info>,
    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,
}

impl<'info> Swap<'info> {
    fn get_host_fee_bps(&self) -> Option<u16> {
        if self.host_fee_in.is_some() {
            Some(HOST_FEE_BPS)
        } else {
            None
        }
    }

    fn swap_transfer(&self, in_amount: u64, out_amount: u64, swap_for_y: bool) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];
        self.transfer_to_reserve(in_amount, swap_for_y)?;
        self.transfer_to_user(out_amount, swap_for_y, signer_seeds)
    }

    fn transfer_from_user_to(
        &self,
        amount: u64,
        swap_for_y: bool,
        destination_ai: AccountInfo<'info>,
    ) -> Result<()> {
        if swap_for_y {
            anchor_spl::token_2022::transfer_checked(
                CpiContext::new(
                    self.token_x_program.to_account_info(),
                    TransferChecked {
                        from: self.user_token_in.to_account_info(),
                        to: destination_ai,
                        authority: self.user.to_account_info(),
                        mint: self.token_x_mint.to_account_info(),
                    },
                ),
                amount,
                self.token_x_mint.decimals,
            )
        } else {
            anchor_spl::token_2022::transfer_checked(
                CpiContext::new(
                    self.token_y_program.to_account_info(),
                    TransferChecked {
                        from: self.user_token_in.to_account_info(),
                        to: destination_ai,
                        authority: self.user.to_account_info(),
                        mint: self.token_y_mint.to_account_info(),
                    },
                ),
                amount,
                self.token_y_mint.decimals,
            )
        }
    }

    fn transfer_to_reserve(&self, amount: u64, swap_for_y: bool) -> Result<()> {
        if swap_for_y {
            self.transfer_from_user_to(amount, swap_for_y, self.reserve_x.to_account_info())
        } else {
            self.transfer_from_user_to(amount, swap_for_y, self.reserve_y.to_account_info())
        }
    }

    fn transfer_to_user(
        &self,
        amount: u64,
        swap_for_y: bool,
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        if swap_for_y {
            anchor_spl::token_2022::transfer_checked(
                CpiContext::new_with_signer(
                    self.token_y_program.to_account_info(),
                    TransferChecked {
                        from: self.reserve_y.to_account_info(),
                        to: self.user_token_out.to_account_info(),
                        authority: self.lb_pair.to_account_info(),
                        mint: self.token_y_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
                self.token_y_mint.decimals,
            )
        } else {
            anchor_spl::token_2022::transfer_checked(
                CpiContext::new_with_signer(
                    self.token_x_program.to_account_info(),
                    TransferChecked {
                        from: self.reserve_x.to_account_info(),
                        to: self.user_token_out.to_account_info(),
                        authority: self.lb_pair.to_account_info(),
                        mint: self.token_x_mint.to_account_info(),
                    },
                    signer_seeds,
                ),
                amount,
                self.token_x_mint.decimals,
            )
        }
    }
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, Swap<'info>>,
    amount_in: u64,
    min_amount_out: u64,
) -> Result<()> {
    Ok(())
}
