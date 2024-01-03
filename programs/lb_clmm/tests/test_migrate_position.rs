#![cfg(feature = "test-bpf")]

mod helpers;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    hash::Hash, instruction::Instruction, program_option::COption, program_pack::Pack,
    pubkey::Pubkey, system_instruction,
};
use anchor_lang::AccountDeserialize;
use anchor_lang::Discriminator;
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use async_trait::async_trait;
use helpers::*;
use lb_clmm::constants::{MAX_BIN_PER_ARRAY, MAX_BIN_PER_POSITION};
use lb_clmm::math::u64x64_math::SCALE_OFFSET;
use lb_clmm::state::bin::{Bin, BinArray, LayoutVersion};
use lb_clmm::state::lb_pair::{self, LbPair};
use lb_clmm::state::position::{FeeInfo, Position, PositionV2, UserRewardInfo};
use lb_clmm::utils::pda::derive_event_authority_pda;
use solana_program_test::*;
use solana_sdk::account::Account;
use solana_sdk::signature::Signer;
use solana_sdk::signer::keypair::Keypair;
use solana_sdk::system_program;
use std::{assert, assert_eq, println};
use utils::*;
#[tokio::test]
async fn test_migrate_position() {
    let mut test = ProgramTest::new("lb_clmm", lb_clmm::id(), processor!(lb_clmm::entry));

    let lb_pair = LbPair::default();
    let lb_pair_pk = Pubkey::new_unique();

    let init_liquidity_supply = 1_000_000u128;

    let mut bins = [Bin::default(); MAX_BIN_PER_ARRAY];
    for bin in bins.iter_mut() {
        bin.liquidity_supply = init_liquidity_supply;
    }

    let bin_array_lower = Pubkey::new_unique();
    {
        let bin_array = BinArray {
            index: 0,
            version: LayoutVersion::V0.into(),
            _padding: [0u8; 7],
            lb_pair: lb_pair_pk,
            bins: bins.clone(),
        };
        lb_clmm_utils::add_bin_array_account(&mut test, &bin_array, bin_array_lower);
    }
    let bin_array_upper = Pubkey::new_unique();
    {
        let bin_array = BinArray {
            index: 1,
            version: LayoutVersion::V0.into(),
            _padding: [0u8; 7],
            lb_pair: lb_pair_pk,
            bins: bins.clone(),
        };
        lb_clmm_utils::add_bin_array_account(&mut test, &bin_array, bin_array_upper);
    }

    lb_clmm_utils::add_lb_pair_account(&mut test, &lb_pair, lb_pair_pk);

    let owner_kp = Keypair::new();
    test.add_account(
        owner_kp.pubkey(),
        Account::new(u32::MAX.into(), 0, &solana_program::system_program::id()),
    );

    let position_v1 = Pubkey::new_unique();
    let init_liquidity = 1_000u64;
    let position = Position {
        lb_pair: lb_pair_pk,
        owner: owner_kp.pubkey(),
        liquidity_shares: [init_liquidity; MAX_BIN_PER_POSITION],
        reward_infos: [UserRewardInfo {
            reward_per_token_completes: [100u128; 2],
            reward_pendings: [10; 2],
        }; MAX_BIN_PER_POSITION],
        fee_infos: [FeeInfo {
            fee_x_per_token_complete: 200,
            fee_y_per_token_complete: 3000,
            fee_x_pending: 4000,
            fee_y_pending: 5000,
        }; MAX_BIN_PER_POSITION],
        lower_bin_id: 1,
        upper_bin_id: MAX_BIN_PER_POSITION as i32,
        last_updated_at: 1000,
        total_claimed_fee_x_amount: 2000,
        total_claimed_fee_y_amount: 3000,
        total_claimed_rewards: [20, 30],
        _reserved: [0u8; 160],
    };
    lb_clmm_utils::add_position_account(&mut test, &position, position_v1);

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    let position_v2_kp = Keypair::new();

    let (event_authority, _bump) = derive_event_authority_pda();
    let migrate_ix = Instruction {
        program_id: lb_clmm::id(),
        accounts: lb_clmm::accounts::MigratePosition {
            lb_pair: lb_pair_pk,
            event_authority,
            program: lb_clmm::id(),
            position_v1,
            position_v2: position_v2_kp.pubkey(),
            bin_array_lower,
            bin_array_upper,
            owner: owner_kp.pubkey(),
            system_program: system_program::id(),
            rent_receiver: owner_kp.pubkey(),
        }
        .to_account_metas(None),
        data: lb_clmm::instruction::MigratePosition {}.data(),
    };
    process_and_assert_ok(
        &[migrate_ix],
        &owner_kp,
        &[&owner_kp, &position_v2_kp],
        &mut banks_client,
    )
    .await;

    let position_v2_state: PositionV2 = banks_client
        .get_account_with_anchor_seder(position_v2_kp.pubkey())
        .await
        .unwrap();

    assert_eq!(position.lb_pair, position_v2_state.lb_pair);
    assert_eq!(position.owner, position_v2_state.owner);
    for (i, &liquidity_share) in position.liquidity_shares.iter().enumerate() {
        assert_eq!(
            position_v2_state.liquidity_shares[i],
            (liquidity_share as u128)
                .checked_shl(SCALE_OFFSET.into())
                .unwrap()
        );
    }

    for (i, &reward_info) in position.reward_infos.iter().enumerate() {
        assert_eq!(position_v2_state.reward_infos[i], reward_info);
    }

    for (i, &fee_info) in position.fee_infos.iter().enumerate() {
        assert_eq!(position_v2_state.fee_infos[i], fee_info);
    }

    assert_eq!(position.lower_bin_id, position_v2_state.lower_bin_id);
    assert_eq!(position.upper_bin_id, position_v2_state.upper_bin_id);
    assert_eq!(position.last_updated_at, position_v2_state.last_updated_at);
    assert_eq!(
        position.total_claimed_fee_x_amount,
        position_v2_state.total_claimed_fee_x_amount
    );
    assert_eq!(
        position.total_claimed_fee_y_amount,
        position_v2_state.total_claimed_fee_y_amount
    );
    assert_eq!(
        position.total_claimed_rewards,
        position_v2_state.total_claimed_rewards
    );
}
