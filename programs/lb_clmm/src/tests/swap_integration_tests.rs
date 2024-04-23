use crate::constants::DEFAULT_BIN_PER_POSITION;
use crate::constants::MAX_BIN_PER_ARRAY;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::u64x64_math::SCALE_OFFSET;
use crate::state::bin::BinArray;
use crate::state::dynamic_position::DynamicPosition;
use crate::state::dynamic_position::PositionBinData;
use crate::state::dynamic_position::PositionV3;
use crate::tests::init_bin_array;
use proptest::proptest;
use rand::Rng;
use std::cell::RefCell;

proptest! {
    #[test]
    fn test_swap_fee_precision(
        fee in 100u64..=1_000_000_000_000_000_000u64,
        liquidity_share in  100u128..=1_000_000_000_000_000u128,
        step in 10u64..=1000u64,
        swap_for_y in 0..=1,
        bin_id in 0..MAX_BIN_PER_ARRAY,
        bin_offset in 0..MAX_BIN_PER_ARRAY,
    ){
        let active_id = 0;
        let mut bin_array = init_bin_array(active_id);


        let global_data = RefCell::new(PositionV3 {
            lower_bin_id: active_id,
            upper_bin_id: active_id + DEFAULT_BIN_PER_POSITION as i32 - 1,
            ..Default::default()
        });
        let position_bin_data = RefCell::new([PositionBinData::default(); DEFAULT_BIN_PER_POSITION]);
        let mut position =
            DynamicPosition::new(global_data.borrow_mut(), position_bin_data.borrow_mut());


        let mut rng = rand::thread_rng();
        let mut i = 0;

        let mut total_swap_fee_x_amount = 0u64;
        let mut total_swap_fee_y_amount = 0u64;
        let mut total_claimed_x_fee = 0u64;
        let mut total_claimed_y_fee = 0u64;
        while i < step {
            match rng.gen_range(0, 3) {
                0 => {

                    let bin = & bin_array.bins[bin_offset];
                    let swap_for_y = if swap_for_y == 0 {
                        false
                    }else{
                        true
                    };
                    if !bin.is_empty(swap_for_y) {
                        if !swap_for_y {
                            total_swap_fee_y_amount = total_swap_fee_y_amount.checked_add(fee).unwrap();
                        }else{
                            total_swap_fee_x_amount = total_swap_fee_x_amount.checked_add(fee).unwrap();
                        }
                        swap(fee, false, &mut bin_array, bin_offset);
                    }
                }
                1 => {
                    deposit( &mut position, &mut bin_array, bin_id as i32, liquidity_share.checked_shl(SCALE_OFFSET.into()).unwrap());
                }
                2 => {
                    let (fee_x, fee_y) = claim_fee(&mut bin_array, &mut position);
                    total_claimed_x_fee = total_claimed_x_fee.checked_add(fee_x).unwrap();
                    total_claimed_y_fee = total_claimed_y_fee.checked_add(fee_y).unwrap();
                }
                _ => panic!("not supported"),
            }
            i += 1;
        }

        // claim everything left
        let (fee_x, fee_y) = claim_fee(&mut bin_array, &mut position);
        total_claimed_x_fee = total_claimed_x_fee.checked_add(fee_x).unwrap();
        total_claimed_y_fee = total_claimed_y_fee.checked_add(fee_y).unwrap();


    if total_swap_fee_x_amount == 0 {
        assert_eq!(total_claimed_x_fee, 0);
    }else{
        assert_eq!(
            (total_swap_fee_x_amount - total_claimed_x_fee) * 10000 / total_swap_fee_x_amount,
            0
        );
    }

    if total_swap_fee_y_amount == 0 {
        assert_eq!(total_claimed_y_fee, 0);
    }else{
        assert_eq!(
            (total_swap_fee_y_amount - total_claimed_y_fee) * 10000 / total_swap_fee_y_amount,
            0
        );
    }
    }
}

fn deposit(
    position: &mut DynamicPosition,
    bin_array: &mut BinArray,
    bin_id: i32,
    liquidity_share: u128,
) {
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
fn swap(fee: u64, swap_for_y: bool, bin_array: &mut BinArray, bin_offset: usize) {
    let bin = &mut bin_array.bins[bin_offset];
    bin.update_fee_per_token_stored(fee, swap_for_y).unwrap();
}

fn claim_fee(bin_array: &mut BinArray, position: &mut DynamicPosition) -> (u64, u64) {
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
        .claim_fee(position.lower_bin_id(), position.upper_bin_id())
        .unwrap()
}
