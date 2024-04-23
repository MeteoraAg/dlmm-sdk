use crate::assert_eq_admin;
use crate::constants::NUM_REWARDS;
use crate::errors::LBError;
use crate::events::UpdateRewardFunder as UpdateRewardFunderEvent;
use crate::state::lb_pair::LbPair;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct UpdateRewardFunder<'info> {
    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(constraint = assert_eq_admin(admin.key()) @ LBError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

impl<'info> UpdateRewardFunder<'info> {
    fn validate(&self, reward_index: usize, new_funder: Pubkey) -> Result<()> {
        require!(reward_index < NUM_REWARDS, LBError::InvalidRewardIndex);

        let lb_pair = self.lb_pair.load()?;
        let reward_info = &lb_pair.reward_infos[reward_index];

        require!(reward_info.initialized(), LBError::RewardUninitialized);

        require!(reward_info.funder != new_funder, LBError::IdenticalFunder,);

        Ok(())
    }
}

pub fn handle(ctx: Context<UpdateRewardFunder>, index: u64, new_funder: Pubkey) -> Result<()> {
    Ok(())
}
