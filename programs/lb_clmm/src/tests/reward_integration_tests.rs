use crate::constants::tests::get_preset;
use crate::constants::*;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::u128x128_math::Rounding;
use crate::math::u64x64_math::*;
use crate::math::utils_math::*;
use crate::state::bin::*;
use crate::state::dynamic_position::DynamicPosition;
use crate::state::dynamic_position::PositionBinData;
use crate::state::dynamic_position::PositionV3;
use crate::state::lb_pair::*;
use crate::state::parameters::*;
use anchor_lang::prelude::*;
use proptest::proptest;
use rand::prelude::*;
use std::cell::RefCell;
use std::cell::RefMut;

#[test]
fn test_fund_reward() {
    let active_id = 0;

    // init lb_pair, binArray and position
    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);
    bin_array.is_bin_id_within_range(active_id).unwrap();

    // Init reward
    let reward_index = 0;
    let reward_duration = 10;
    init_reward(&mut lb_pair, reward_index, reward_duration);

    // Fund reward first time
    let current_time = 100;
    let funding_amount = 1000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        funding_amount,
        current_time,
    );

    assert_lb_pair_reward_first_funding(
        &lb_pair,
        reward_index,
        reward_duration,
        current_time,
        funding_amount,
    );

    // 3. Fund reward second time
    let passed_duration = 5;
    let fund_amount_1 = 2000;

    let distributed_reward = distributed_reward(&lb_pair, reward_index, passed_duration);
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        fund_amount_1,
        current_time + passed_duration,
    );

    assert_lb_pair_reward(
        &lb_pair,
        reward_index,
        current_time + passed_duration,
        funding_amount + fund_amount_1 - distributed_reward,
    );

    // TODO add function clawback in case passed_duration, but no one actually deposit liquidity
}

#[test]
fn test_claim_reward() {
    let active_id = 0;

    // 0. init lb_pair, binArray and position
    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);
    bin_array.is_bin_id_within_range(active_id).unwrap();

    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position_0 =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

    position_0.id_within_position(active_id).unwrap();

    // Deposit
    let liquidity_share = 100u128.checked_shl(SCALE_OFFSET.into()).unwrap();
    let current_time = 100;
    deposit(
        &mut lb_pair,
        &mut position_0,
        &mut bin_array,
        active_id,
        liquidity_share,
        current_time,
    );
    assert_position_liquidity(&mut position_0, active_id, liquidity_share);
    assert_bin_liquidity(&mut bin_array, active_id, liquidity_share);

    let reward_index = 0;
    let reward_duration = 10;
    init_reward(&mut lb_pair, reward_index, reward_duration);

    // Fund reward first time
    let funding_amount = 1000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        funding_amount,
        current_time,
    );

    let passed_duration_0 = 5;
    let drop_reward = distributed_reward(&lb_pair, reward_index, passed_duration_0);
    let current_time = current_time + passed_duration_0;

    let total_reward_0 = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position_0,
        reward_index,
        current_time,
    );

    assert_eq!(total_reward_0, drop_reward);

    position_0
        .reset_all_pending_reward(
            reward_index,
            position_0.lower_bin_id(),
            position_0.upper_bin_id(),
        )
        .unwrap();
    let total_reward = position_0
        .get_total_reward(
            reward_index,
            position_0.lower_bin_id(),
            position_0.upper_bin_id(),
        )
        .unwrap();
    assert_eq!(total_reward, 0);

    // other user deposit
    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position_1 =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());
    // Deposit
    deposit(
        &mut lb_pair,
        &mut position_1,
        &mut bin_array,
        active_id,
        liquidity_share,
        current_time,
    );
    let passed_duration_1 = 5;
    let current_time = current_time + passed_duration_1;
    let drop_reward = distributed_reward(
        &lb_pair,
        reward_index,
        passed_duration_0 + passed_duration_1,
    ) - drop_reward;

    let total_reward_0 = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position_0,
        reward_index,
        current_time,
    );
    let total_reward_1 = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position_1,
        reward_index,
        current_time,
    );
    assert_eq!(total_reward_0 + total_reward_1, drop_reward);
}

#[test]
fn test_deposit_after_reward_duration_end() {
    let active_id = 0;

    // 0. init lb_pair, binArray and position
    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);
    bin_array.is_bin_id_within_range(active_id).unwrap();

    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

    position.id_within_position(active_id).unwrap();

    let current_time = 100;

    let reward_index = 0;
    let reward_duration = 10;
    init_reward(&mut lb_pair, reward_index, reward_duration);

    // Fund reward first time
    let funding_amount = 1000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        funding_amount,
        current_time,
    );

    // Deposit after reward duration end
    let current_time = current_time + reward_duration + 1;
    let liquidity_share = 100u128.checked_shl(SCALE_OFFSET.into()).unwrap();
    deposit(
        &mut lb_pair,
        &mut position,
        &mut bin_array,
        active_id,
        liquidity_share,
        current_time,
    );
    let total_reward = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position,
        reward_index,
        current_time,
    );
    // get nothing because reward will not distribute to bin with empty liquidity
    assert_eq!(total_reward, 0);
}

#[test]
fn test_two_reward_index() {
    let active_id = 0;

    // 0. init lb_pair, binArray and position
    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);

    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

    // Deposit
    let liquidity_share = 100u128.checked_shl(SCALE_OFFSET.into()).unwrap();
    let current_time = 100;
    deposit(
        &mut lb_pair,
        &mut position,
        &mut bin_array,
        active_id,
        liquidity_share,
        current_time,
    );

    let reward_index_0 = 0;
    let reward_duration_0 = 10;
    init_reward(&mut lb_pair, reward_index_0, reward_duration_0);

    // Fund reward first time
    let funding_amount_0 = 1000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index_0,
        funding_amount_0,
        current_time,
    );

    let reward_index_1 = 1;
    let reward_duration_1 = 15;
    init_reward(&mut lb_pair, reward_index_1, reward_duration_1);

    // Fund reward first time
    let funding_amount_1 = 2000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index_1,
        funding_amount_1,
        current_time,
    );

    let current_time_0 = current_time + reward_duration_0;
    let current_time_1 = current_time + reward_duration_1;

    let current_time = if current_time_0 > current_time_1 {
        current_time_0
    } else {
        current_time_1
    };

    let total_reward_0 = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position,
        reward_index_0,
        current_time,
    );
    let total_reward_1 = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position,
        reward_index_1,
        current_time,
    );

    assert_eq!(funding_amount_0 - total_reward_0 <= 1, true); // precision
    assert_eq!(funding_amount_1 - total_reward_1 <= 1, true); // precision
}

#[test]
fn test_change_reward_duration() {
    let active_id = 0;

    // 0. init lb_pair, binArray and position
    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);

    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

    // Deposit
    let liquidity_share = 100u128.checked_shl(SCALE_OFFSET.into()).unwrap();
    let current_time = 100;
    deposit(
        &mut lb_pair,
        &mut position,
        &mut bin_array,
        active_id,
        liquidity_share,
        current_time,
    );

    let reward_index = 0;
    let reward_duration = 10;
    init_reward(&mut lb_pair, reward_index, reward_duration);

    // Fund reward first time
    let funding_amount_0 = 1000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        funding_amount_0,
        current_time,
    );

    let reward_duration = 15;
    let current_time = current_time + reward_duration + 1;
    change_reward_duration(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        reward_duration,
        current_time,
    );
    // Fund reward second time
    let funding_amount_1 = 2000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        funding_amount_1,
        current_time,
    );

    let current_time = current_time + reward_duration + 1;
    let total_reward = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position,
        reward_index,
        current_time,
    );
    assert_eq!(
        funding_amount_0 + funding_amount_1 - total_reward <= 1,
        true
    ); // precision
}

#[test]
fn test_reward_cross_multiple_bin_ids() {
    let active_id = 0;
    let reward_index = 0;
    let reward_duration = 10;

    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);
    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

    // Deposit
    let liquidity_share = 100u128.checked_shl(SCALE_OFFSET.into()).unwrap();
    let current_time = 100;
    deposit(
        &mut lb_pair,
        &mut position,
        &mut bin_array,
        active_id,
        liquidity_share,
        current_time,
    );
    deposit(
        &mut lb_pair,
        &mut position,
        &mut bin_array,
        active_id + 1,
        liquidity_share,
        current_time,
    );
    init_reward(&mut lb_pair, reward_index, reward_duration);

    // Fund reward first time
    let funding_amount = 1000;
    fund_reward(
        &mut lb_pair,
        &mut bin_array,
        reward_index,
        funding_amount,
        current_time,
    );

    // swap caused active id change
    let passed_duration = 5;
    let current_time = current_time + passed_duration;

    swap(&mut lb_pair, &mut bin_array, current_time, active_id + 1);

    let current_time = current_time + reward_duration;
    let total_reward = claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position,
        reward_index,
        current_time,
    );

    assert_eq!(total_reward, funding_amount);
}

proptest! {
    #[test]
    fn test_reward_precision(
        funding_amount in 100u64..=1_000_000_000_000_000u64,
        liquidity_share in 100u128..=1_000_000_000_000_000u128,
        step in 10u64..=1000u64,
    ) {
        let active_id = 0;
        let reward_index = 0;
        let init_current_time = 100_000;
        let mut current_time = init_current_time;

        // 0. init lb_pair, binArray and position
        let lb_pair = init_lb_pair(active_id);
        let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

        let mut bin_array = init_bin_array(active_id);
        let global_data = RefCell::new(PositionV3 {
            lower_bin_id: active_id,
            upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
            ..Default::default()
        });
        let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
        let mut position =
            DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

        let reward_duration = 10_000;
        init_reward(&mut lb_pair, reward_index, reward_duration);

        let mut rng = rand::thread_rng();
        let mut i = 0;

        let mut total_funding_amount = 0;
        let mut total_claimed_reward = 0;

        // Deposit first, to ensure there always have reward distribution
        deposit(
            &mut lb_pair,
            &mut position,
            &mut bin_array,
            active_id,
            liquidity_share.checked_shl(SCALE_OFFSET.into()).unwrap(),
            current_time,
        );

        while i < step {
            let passed_duration = rng.gen_range(0, reward_duration / step);
            current_time += passed_duration;
            match rng.gen_range(0, 4) {
                0 => {
                    // simulate fund reward
                    fund_reward(
                        &mut lb_pair,
                        &mut bin_array,
                        reward_index,
                        funding_amount,
                        current_time,
                    );

                    total_funding_amount += funding_amount;
                }
                1 => {
                    // simulate swap
                    swap(&mut lb_pair, &mut bin_array, current_time, active_id);
                }
                2 => {
                    // simulate deposit liquidity
                    deposit(
                        &mut lb_pair,
                        &mut position,
                        &mut bin_array,
                        active_id,
                        liquidity_share.checked_shl(SCALE_OFFSET.into()).unwrap(),
                        current_time,
                    )
                }
                3 => {
                    // simulate claim reward
                    total_claimed_reward += claim_reward(
                        &mut lb_pair,
                        &mut bin_array,
                        &mut position,
                        reward_index,
                        current_time,
                    );
                    position.reset_all_pending_reward(reward_index, position.lower_bin_id(), position.upper_bin_id()).unwrap();
                }
                _ => panic!("not supported"),
            }
            i += 1;
        }

        // claim everything left
        total_claimed_reward += claim_reward(
            &mut lb_pair,
            &mut bin_array,
            &mut position,
            reward_index,
            current_time + reward_duration,
        );

        // Avoid division 0 when there's no funding randomized
        if total_funding_amount > 0 {
            assert_eq!(
                (total_funding_amount - total_claimed_reward) * 10
                / total_funding_amount,
                0
            );
        }
   }

}

#[test]
fn test_rand_reward() {
    let active_id = 0;
    let reward_index = 0;
    let init_current_time = 100_000;
    let mut current_time = init_current_time;

    // 0. init lb_pair, binArray and position
    let lb_pair = init_lb_pair(active_id);
    let mut lb_pair = lb_pair.try_borrow_mut().unwrap();

    let mut bin_array = init_bin_array(active_id);
    let global_data = RefCell::new(PositionV3 {
        lower_bin_id: active_id,
        upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
        ..Default::default()
    });
    let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
    let mut position =
        DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());

    let reward_duration = 10_000;
    init_reward(&mut lb_pair, reward_index, reward_duration);

    let mut rng = rand::thread_rng();
    let mut i = 0;

    let mut total_funding_amount = 0;
    let mut total_claimed_reward = 0;
    let step = 1000;
    let mut count_fund_reward = 0;
    let mut count_swap = 0;
    let mut count_deposit = 0;
    let mut count_claim = 0;
    while i < step {
        let passed_duration = rng.gen_range(0, reward_duration / step);
        current_time += passed_duration;
        match rng.gen_range(0, 4) {
            0 => {
                count_fund_reward += 1;
                // simulate fund reward
                let funding_amount = rng.gen_range(100u64, 1_000_000_000_000_000u64);
                fund_reward(
                    &mut lb_pair,
                    &mut bin_array,
                    reward_index,
                    funding_amount,
                    current_time,
                );

                total_funding_amount += funding_amount;
            }
            1 => {
                // simulate swap
                count_swap += 1;
                swap(&mut lb_pair, &mut bin_array, current_time, active_id);
            }
            2 => {
                // simulate deposit liquidity
                count_deposit += 1;
                let liquidity_share = rng.gen_range(100u128, 1_000_000_000_000_000u128);
                deposit(
                    &mut lb_pair,
                    &mut position,
                    &mut bin_array,
                    active_id,
                    liquidity_share.checked_shl(SCALE_OFFSET.into()).unwrap(),
                    current_time,
                )
            }
            3 => {
                // simulate claim reward
                count_claim += 1;
                total_claimed_reward += claim_reward(
                    &mut lb_pair,
                    &mut bin_array,
                    &mut position,
                    reward_index,
                    current_time,
                );
                position
                    .reset_all_pending_reward(
                        reward_index,
                        position.lower_bin_id(),
                        position.upper_bin_id(),
                    )
                    .unwrap();
            }
            _ => panic!("not supported"),
        }
        i += 1;
    }

    // claim everything left
    total_claimed_reward += claim_reward(
        &mut lb_pair,
        &mut bin_array,
        &mut position,
        reward_index,
        current_time + reward_duration,
    );

    println!(
        "{} {} {} {}",
        count_fund_reward, count_swap, count_deposit, count_claim
    );
    assert_eq!(
        (total_funding_amount - total_claimed_reward) * 1000 / total_funding_amount,
        0
    );
}

fn claim_reward(
    lb_pair: &mut RefMut<'_, LbPair>,
    bin_array: &mut BinArray,
    position: &mut DynamicPosition,
    reward_index: usize,
    current_time: u64,
) -> u64 {
    bin_array.update_all_rewards(lb_pair, current_time).unwrap();

    let bin_arra_c = RefCell::new(*bin_array);
    let mut bin_arrays = [bin_arra_c.borrow_mut()];

    let bin_array_manager = BinArrayManager::new(&mut bin_arrays).unwrap();

    position
        .update_earning_per_token_stored(
            &bin_array_manager,
            position.lower_bin_id(),
            position.upper_bin_id(),
        )
        .unwrap();

    position
        .get_total_reward(
            reward_index,
            position.lower_bin_id(),
            position.upper_bin_id(),
        )
        .unwrap()
}

fn init_lb_pair(active_id: i32) -> RefCell<LbPair> {
    let bin_step = 10;
    let lb_pair = LbPair {
        parameters: get_preset(bin_step).unwrap(),
        bin_step,
        active_id: active_id,
        bump_seed: [0],
        protocol_fee: ProtocolFee::default(),
        token_x_mint: Pubkey::default(),
        token_y_mint: Pubkey::default(),
        reserve_x: Pubkey::default(),
        reserve_y: Pubkey::default(),
        bin_step_seed: [0u8; 2],
        v_parameters: VariableParameters {
            volatility_accumulator: 10000,
            ..VariableParameters::default()
        },
        fee_owner: Pubkey::default(),
        reward_infos: [RewardInfo::default(); NUM_REWARDS],
        ..Default::default()
    };
    RefCell::new(lb_pair)
}

pub fn init_bin_array(active_id: i32) -> BinArray {
    let index = (active_id % (MAX_BIN_PER_ARRAY as i32)) as i64;
    BinArray {
        index,
        lb_pair: Pubkey::default(),
        version: LayoutVersion::V1.into(),
        _padding: [0u8; 7],
        bins: [Bin::default(); MAX_BIN_PER_ARRAY],
    }
}

// pub fn init_position<'a>(position: &mut DynamicPosition, active_id: i32) {

//     position.init
//     let lower_bin_id = active_id;
//     let upper_bin_id = active_id + DEFAULT_BIN_PER_POSITION as i32 - 1;

//     let global_data = RefCell::new(PositionV3 {
//         lower_bin_id,
//         upper_bin_id,
//         ..Default::default()
//     });
//     let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
//     DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut())
// }

fn change_reward_duration(
    lb_pair: &mut RefMut<'_, LbPair>,
    bin_array: &mut BinArray,
    reward_index: usize,
    new_duration: u64,
    current_time: u64,
) {
    bin_array.update_all_rewards(lb_pair, current_time).unwrap();

    let reward_info = &mut lb_pair.reward_infos[reward_index];
    reward_info.reward_duration = new_duration;
}

fn swap(
    lb_pair: &mut RefMut<'_, LbPair>,
    bin_array: &mut BinArray,
    current_timestamp: u64,
    new_bin_id: i32,
) {
    let active_id = lb_pair.active_id;
    if bin_array.is_bin_id_within_range(active_id).is_ok() {
        // update rewards
        bin_array
            .update_all_rewards(lb_pair, current_timestamp)
            .unwrap();
    }
    // update new bin id
    lb_pair.active_id = new_bin_id;
}

fn deposit(
    lb_pair: &mut RefMut<'_, LbPair>,
    position: &mut DynamicPosition,
    bin_array: &mut BinArray,
    bin_id: i32,
    liquidity_share: u128,
    current_time: u64,
) {
    // let active_id = lb_pair.active_id;
    bin_array.update_all_rewards(lb_pair, current_time).unwrap();

    let bin_arra_c = RefCell::new(*bin_array);
    let mut bin_arrays = [bin_arra_c.borrow_mut()];

    let bin_array_manager = BinArrayManager::new(&mut bin_arrays).unwrap();

    position
        .update_earning_per_token_stored(
            &bin_array_manager,
            position.lower_bin_id(),
            position.upper_bin_id(),
        )
        .unwrap();

    position.deposit(bin_id, liquidity_share).unwrap();
    let bin = bin_array.get_bin_mut(bin_id).unwrap();
    bin.deposit(0, 0, liquidity_share).unwrap();
}

fn assert_position_liquidity(position: &mut DynamicPosition, bin_id: i32, liquidity_share: u128) {
    let position_share = position.get_liquidity_share_in_bin(bin_id).unwrap();
    assert_eq!(position_share, liquidity_share);
}

fn assert_bin_liquidity(bin_array: &mut BinArray, bin_id: i32, liquidity_share: u128) {
    let bin = bin_array.get_bin(bin_id).unwrap();
    assert_eq!(bin.liquidity_supply, liquidity_share);
}

fn init_reward(lb_pair: &mut LbPair, reward_index: usize, reward_duration: u64) {
    let reward_info = &mut lb_pair.reward_infos[reward_index];
    reward_info.init_reward(
        Pubkey::new_unique(),
        Pubkey::default(),
        Pubkey::default(),
        reward_duration,
    );
}

fn fund_reward(
    lb_pair: &mut RefMut<'_, LbPair>,
    bin_array: &mut BinArray,
    reward_index: usize,
    amount: u64,
    current_time: u64,
) {
    bin_array.update_all_rewards(lb_pair, current_time).unwrap();

    let reward_info = &mut lb_pair.reward_infos[reward_index];
    reward_info
        .update_rate_after_funding(current_time, amount)
        .unwrap();
}

fn assert_lb_pair_reward_first_funding(
    lb_pair: &LbPair,
    reward_index: usize,
    reward_duration: u64,
    current_time: u64,
    funding_amount: u64,
) {
    let reward_info = &lb_pair.reward_infos[reward_index];
    assert_eq!(reward_info.reward_duration, reward_duration);
    assert_eq!(
        reward_info.reward_duration_end,
        reward_duration + current_time
    );
    assert_eq!(reward_info.last_update_time, current_time);

    let reward_rate = safe_shl_div_cast(
        funding_amount.into(),
        reward_duration as u128,
        SCALE_OFFSET,
        Rounding::Down,
    )
    .unwrap();

    assert_eq!(reward_info.reward_rate, reward_rate);
}

fn distributed_reward(lb_pair: &LbPair, reward_index: usize, passed_duration: u64) -> u64 {
    let reward_info = &lb_pair.reward_infos[reward_index];

    let distributed_reward: u64 = safe_mul_shr_cast(
        reward_info.reward_rate,
        passed_duration as u128,
        SCALE_OFFSET,
        Rounding::Down,
    )
    .unwrap();
    return distributed_reward;
}
fn assert_lb_pair_reward(
    lb_pair: &LbPair,
    reward_index: usize,
    current_time: u64,
    total_funding_amount: u64,
) {
    let reward_info = &lb_pair.reward_infos[reward_index];
    assert_eq!(
        reward_info.reward_duration_end,
        reward_info.reward_duration + current_time
    );
    assert_eq!(reward_info.last_update_time, current_time);

    let reward_rate = safe_shl_div_cast(
        total_funding_amount.into(),
        reward_info.reward_duration as u128,
        SCALE_OFFSET,
        Rounding::Down,
    )
    .unwrap();

    assert_eq!(reward_info.reward_rate, reward_rate);
}
