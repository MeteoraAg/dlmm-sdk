use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use ruint::aliases::U256;

use crate::{
    constants::NUM_REWARDS,
    errors::LBError,
    events::WithdrawIneligibleReward as WithdrawIneligibleRewardEvent,
    manager::bin_array_manager::BinArrayManager,
    math::{safe_math::SafeMath, u64x64_math::SCALE_OFFSET},
    state::{bin::BinArray, lb_pair::LbPair},
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct WithdrawIneligibleReward<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub funder_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub funder: Signer<'info>,

    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array: AccountLoader<'info, BinArray>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> WithdrawIneligibleReward<'info> {
    fn validate(&self, reward_index: usize) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        require!(reward_index < NUM_REWARDS, LBError::InvalidRewardIndex);

        let reward_info = &lb_pair.reward_infos[reward_index];

        require!(reward_info.initialized(), LBError::RewardUninitialized);

        require!(
            reward_info.vault.eq(&self.reward_vault.key()),
            LBError::InvalidRewardVault
        );

        require!(
            reward_info.is_valid_funder(self.funder.key()),
            LBError::InvalidAdmin
        );

        let current_timestamp = Clock::get()?.unix_timestamp as u64;

        require!(
            current_timestamp >= reward_info.reward_duration_end,
            LBError::RewardNotEnded
        );

        Ok(())
    }

    fn transfer_from_vault_to_funder(&self, amount: u64) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];

        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.reward_vault.to_account_info(),
                    to: self.funder_token_account.to_account_info(),
                    authority: self.lb_pair.to_account_info(),
                    mint: self.reward_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.reward_mint.decimals,
        )
    }
}

pub fn handle(ctx: Context<WithdrawIneligibleReward>, index: u64) -> Result<()> {
    Ok(())
}
