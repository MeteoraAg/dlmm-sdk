use crate::authorize_modify_position;
use crate::errors::LBError;
use crate::events::ClaimReward as ClaimRewardEvent;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::safe_math::SafeMath;
use crate::state::dynamic_position::{DynamicPositionLoader, PositionV3};
use crate::BinArrayAccount;
use crate::PositionLiquidityFlowValidator;
use crate::{
    constants::NUM_REWARDS,
    state::{bin::BinArray, lb_pair::LbPair},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface, TransferChecked};
use std::collections::{BTreeMap, BTreeSet};

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, PositionV3>,

    pub sender: Signer<'info>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ClaimReward<'info> {
    fn validate(&self, reward_index: usize) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        require!(reward_index < NUM_REWARDS, LBError::InvalidRewardIndex);

        let reward_info = &lb_pair.reward_infos[reward_index];
        require!(reward_info.initialized(), LBError::RewardUninitialized);
        require!(
            reward_info.vault.eq(&self.reward_vault.key()),
            LBError::InvalidRewardVault
        );

        Ok(())
    }

    fn transfer_from_reward_vault_to_user(&self, amount: u64) -> Result<()> {
        let lb_pair = self.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.reward_vault.to_account_info(),
                    to: self.user_token_account.to_account_info(),
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

impl<'a, 'b, 'c, 'info> PositionLiquidityFlowValidator for ClaimReward<'info> {
    fn validate_outflow_to_ata_of_position_owner(&self, owner: Pubkey) -> Result<()> {
        let dest_reward_token = anchor_spl::associated_token::get_associated_token_address(
            &owner,
            &self.reward_mint.key(),
        );
        require!(
            dest_reward_token == self.user_token_account.key()
                && self.user_token_account.owner == owner,
            LBError::WithdrawToWrongTokenAccount
        );

        Ok(())
    }
}

// TODO: Should we pass in range of bin we are going to collect reward ? It could help us in heap / compute unit issue by chunking into multiple tx.
pub fn handle(
    ctx: Context<ClaimReward>,
    index: u64,
    min_bin_id: i32,
    max_bin_id: i32,
) -> Result<()> {
    Ok(())
}
