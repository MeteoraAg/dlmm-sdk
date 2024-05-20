use crate::constants::NUM_REWARDS;
use crate::errors::LBError;
use crate::events::FundReward as FundRewardEvent;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::safe_math::SafeMath;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::state::{bin::BinArray, lb_pair::LbPair};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use ruint::aliases::U256;

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct FundReward<'info> {
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

impl<'info> FundReward<'info> {
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

        Ok(())
    }

    fn transfer_from_funder_to_vault(&self, amount: u64) -> Result<()> {
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.funder_token_account.to_account_info(),
                    to: self.reward_vault.to_account_info(),
                    authority: self.funder.to_account_info(),
                    mint: self.reward_mint.to_account_info(),
                },
            ),
            amount,
            self.reward_mint.decimals,
        )
    }
}

pub fn handle(
    ctx: Context<FundReward>,
    index: u64,
    amount: u64,
    carry_forward: bool,
) -> Result<()> {
    Ok(())
}
