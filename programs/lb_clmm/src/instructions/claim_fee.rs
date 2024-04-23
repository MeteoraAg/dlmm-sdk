use crate::authorize_claim_fee_position;
use crate::errors::LBError;
use crate::events::ClaimFee as ClaimFeeEvent;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::safe_math::SafeMath;
use crate::state::dynamic_position::{DynamicPositionLoader, PositionV3};
use crate::state::{bin::BinArray, lb_pair::LbPair};
use crate::BinArrayAccount;
use crate::PositionLiquidityFlowValidator;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use std::collections::{BTreeMap, BTreeSet};
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimFee<'info> {
    #[account(
        mut,
        has_one = reserve_x,
        has_one = reserve_y,
        has_one = token_x_mint,
        has_one = token_y_mint,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_claim_fee_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, PositionV3>,

    pub sender: Signer<'info>,

    #[account(mut)]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub user_token_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_token_y: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ClaimFee<'info> {
    fn transfer_from_reserve_x(&self, amount: u64) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.reserve_x.to_account_info(),
                    to: self.user_token_x.to_account_info(),
                    authority: self.lb_pair.to_account_info(),
                    mint: self.token_x_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.token_x_mint.decimals,
        )
    }

    fn transfer_from_reserve_y(&self, amount: u64) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.reserve_y.to_account_info(),
                    to: self.user_token_y.to_account_info(),
                    authority: self.lb_pair.to_account_info(),
                    mint: self.token_y_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.token_y_mint.decimals,
        )
    }
}

impl<'a, 'b, 'c, 'info> PositionLiquidityFlowValidator for ClaimFee<'info> {
    fn validate_outflow_to_ata_of_position_owner(&self, owner: Pubkey) -> Result<()> {
        let dest_token_x = anchor_spl::associated_token::get_associated_token_address(
            &owner,
            &self.token_x_mint.key(),
        );
        require!(
            dest_token_x == self.user_token_x.key() && self.user_token_x.owner == owner,
            LBError::WithdrawToWrongTokenAccount
        );

        let dest_token_y = anchor_spl::associated_token::get_associated_token_address(
            &owner,
            &self.token_y_mint.key(),
        );
        require!(
            dest_token_y == self.user_token_y.key() && self.user_token_y.owner == owner,
            LBError::WithdrawToWrongTokenAccount
        );
        Ok(())
    }
}

pub fn handle(ctx: Context<ClaimFee>, min_bin_id: i32, max_bin_id: i32) -> Result<()> {
    Ok(())
}
