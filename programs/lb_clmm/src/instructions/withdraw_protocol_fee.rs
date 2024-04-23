use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::errors::LBError;
use crate::state::lb_pair::LbPair;

#[derive(Accounts)]
pub struct WithdrawProtocolFee<'info> {
    #[account(
        mut,
        has_one = reserve_x,
        has_one = reserve_y,
        has_one = token_x_mint,
        has_one = token_y_mint,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(mut)]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub receiver_token_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub receiver_token_y: Box<InterfaceAccount<'info, TokenAccount>>,

    pub fee_owner: Signer<'info>,

    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,
}

impl<'info> WithdrawProtocolFee<'info> {
    fn validate(&self, amount_x: u64, amount_y: u64) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;

        require!(
            lb_pair.fee_owner.eq(&self.fee_owner.key()),
            LBError::InvalidFeeOwner
        );

        require!(
            amount_x <= lb_pair.protocol_fee.amount_x,
            LBError::InvalidFeeWithdrawAmount
        );

        require!(
            amount_y <= lb_pair.protocol_fee.amount_y,
            LBError::InvalidFeeWithdrawAmount
        );

        Ok(())
    }

    fn withdraw_fee(&self, amount_x: u64, amount_y: u64) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_x_program.to_account_info(),
                TransferChecked {
                    from: self.reserve_x.to_account_info(),
                    to: self.receiver_token_x.to_account_info(),
                    authority: self.lb_pair.to_account_info(),
                    mint: self.token_x_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount_x,
            self.token_x_mint.decimals,
        )?;

        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_y_program.to_account_info(),
                TransferChecked {
                    from: self.reserve_y.to_account_info(),
                    to: self.receiver_token_y.to_account_info(),
                    authority: self.lb_pair.to_account_info(),
                    mint: self.token_y_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount_y,
            self.token_y_mint.decimals,
        )
    }
}

pub fn handle(ctx: Context<WithdrawProtocolFee>, amount_x: u64, amount_y: u64) -> Result<()> {
    Ok(())
}
