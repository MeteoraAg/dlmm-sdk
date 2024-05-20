use crate::assert_eq_admin;
use crate::constants::{MAX_REWARD_DURATION, MIN_REWARD_DURATION, NUM_REWARDS};
use crate::errors::LBError;
use crate::events::UpdateRewardDuration as UpdateRewardDurationEvent;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::state::bin::BinArray;
use crate::state::lb_pair::LbPair;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct UpdateRewardDuration<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        constraint = assert_eq_admin(admin.key()) @ LBError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = lb_pair
    )]
    pub bin_array: AccountLoader<'info, BinArray>,
}

impl<'info> UpdateRewardDuration<'info> {
    fn validate(&self, reward_index: usize, new_reward_duration: u64) -> Result<()> {
        require!(reward_index < NUM_REWARDS, LBError::InvalidRewardIndex);
        require!(
            new_reward_duration >= MIN_REWARD_DURATION
                && new_reward_duration <= MAX_REWARD_DURATION,
            LBError::InvalidRewardDuration
        );

        let lb_pair = self.lb_pair.load()?;
        let reward_info = &lb_pair.reward_infos[reward_index];

        require!(reward_info.initialized(), LBError::RewardUninitialized);
        require!(
            reward_info.reward_duration != new_reward_duration,
            LBError::IdenticalRewardDuration,
        );

        let current_time = Clock::get()?.unix_timestamp;
        // only allow update reward duration if previous reward has been finished
        require!(
            reward_info.reward_duration_end < current_time as u64,
            LBError::RewardCampaignInProgress,
        );

        Ok(())
    }
}

pub fn handle(
    ctx: Context<UpdateRewardDuration>,
    index: u64,
    new_reward_duration: u64,
) -> Result<()> {
    Ok(())
}
