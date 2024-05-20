use anchor_client::{solana_sdk::signer::Signer, Program};
use anchor_lang::prelude::*;
use lb_clmm::math::safe_math::SafeMath;
use lb_clmm::state::dynamic_position::get_idx;
use lb_clmm::state::dynamic_position::{PositionBinData, PositionV3};
use num_traits::identities::Zero;
use std::ops::Deref;
use std::result::Result::Ok;

pub fn fetch_dynamic_position<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    position: Pubkey,
) -> anyhow::Result<DynamicPosition> {
    let data = program.rpc().get_account_data(&position)?;
    let (global_bytes, position_bin_data_bytes) = data.split_at(8 + PositionV3::INIT_SPACE);
    let global_data = bytemuck::from_bytes::<PositionV3>(&global_bytes[8..]);
    let position_bin_data = bytemuck::cast_slice::<u8, PositionBinData>(position_bin_data_bytes);
    Ok(DynamicPosition {
        global_data: global_data.clone(),
        position_bin_data: position_bin_data.to_vec(),
    })
}

#[derive(Debug)]
pub struct DynamicPosition {
    pub global_data: PositionV3,
    pub position_bin_data: Vec<PositionBinData>,
}

impl DynamicPosition {
    pub fn from_idx_to_bin_id(&self, i: usize) -> Result<i32> {
        Ok(self.lower_bin_id().safe_add(i as i32)?)
    }

    pub fn owner(&self) -> Pubkey {
        self.global_data.owner
    }

    pub fn lower_bin_id(&self) -> i32 {
        self.global_data.lower_bin_id
    }

    pub fn upper_bin_id(&self) -> i32 {
        self.global_data.upper_bin_id
    }

    pub fn lb_pair(&self) -> Pubkey {
        self.global_data.lb_pair
    }

    pub fn get_total_reward(&self, reward_index: usize) -> Result<u64> {
        let mut total_reward = 0u64;
        for val in self.position_bin_data.iter() {
            total_reward = total_reward.safe_add(val.reward_info.reward_pendings[reward_index])?;
        }
        Ok(total_reward)
    }

    /// Position is empty when rewards is 0, fees is 0, and liquidity share is 0.
    pub fn is_empty(&self) -> bool {
        for position_bin_data in self.position_bin_data.iter() {
            if !position_bin_data.liquidity_share.is_zero() {
                return false;
            }
            let reward_infos = &position_bin_data.reward_info;

            for reward_pending in reward_infos.reward_pendings {
                if !reward_pending.is_zero() {
                    return false;
                }
            }

            let fee_infos = &position_bin_data.fee_info;
            if !fee_infos.fee_x_pending.is_zero() || !fee_infos.fee_y_pending.is_zero() {
                return false;
            }
        }
        true
    }

    pub fn get_liquidity_share_in_bin(&self, bin_id: i32) -> Result<u128> {
        let idx = get_idx(bin_id, self.global_data.lower_bin_id)?;
        Ok(self.position_bin_data[idx].liquidity_share)
    }
}
