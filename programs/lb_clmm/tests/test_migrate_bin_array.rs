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
use lb_clmm::constants::MAX_BIN_PER_ARRAY;
use lb_clmm::math::u64x64_math::SCALE_OFFSET;
use lb_clmm::state::bin::{Bin, BinArray, LayoutVersion};
use lb_clmm::state::lb_pair::{self, LbPair};
use solana_program_test::*;
use solana_sdk::account::Account;
use std::{assert, assert_eq, println};
use utils::*;

#[tokio::test]
async fn test_migrate_bin_array() {
    let mut test = ProgramTest::new("lb_clmm", lb_clmm::id(), processor!(lb_clmm::entry));

    let lb_pair = LbPair::default();
    let lb_pair_pk = Pubkey::new_unique();

    let init_liquidity_supply = 1_000_000u128;

    let mut bins = [Bin::default(); MAX_BIN_PER_ARRAY];
    for bin in bins.iter_mut() {
        bin.liquidity_supply = init_liquidity_supply;
    }

    lb_clmm_utils::add_lb_pair_account(&mut test, &lb_pair, lb_pair_pk);

    let bin_array_0_pk = Pubkey::new_unique();
    {
        let bin_array = BinArray {
            index: 0,
            version: LayoutVersion::V0.into(),
            _padding: [0u8; 7],
            lb_pair: lb_pair_pk,
            bins: bins.clone(),
        };
        lb_clmm_utils::add_bin_array_account(&mut test, &bin_array, bin_array_0_pk);
    }
    let bin_array_1_pk = Pubkey::new_unique();
    {
        let bin_array = BinArray {
            index: 1,
            version: LayoutVersion::V0.into(),
            _padding: [0u8; 7],
            lb_pair: lb_pair_pk,
            bins: bins.clone(),
        };
        lb_clmm_utils::add_bin_array_account(&mut test, &bin_array, bin_array_1_pk);
    }

    let (mut banks_client, payer, _recent_blockhash) = test.start().await;

    let mut accounts = lb_clmm::accounts::MigrateBinArray {
        lb_pair: lb_pair_pk,
    }
    .to_account_metas(None);
    let mut remaining_accounts = vec![
        AccountMeta::new(bin_array_0_pk, false),
        AccountMeta::new(bin_array_1_pk, false),
    ];
    accounts.append(&mut remaining_accounts);

    let migrate_bin_array_ix = Instruction {
        program_id: lb_clmm::id(),
        accounts,
        data: lb_clmm::instruction::MigrateBinArray {}.data(),
    };

    process_and_assert_ok(
        &[migrate_bin_array_ix],
        &payer,
        &[&payer],
        &mut banks_client,
    )
    .await;

    // verify new state
    let bin_array_0_state: BinArray = banks_client
        .get_account_with_anchor_seder(bin_array_0_pk)
        .await
        .unwrap();

    let v1: u8 = LayoutVersion::V1.into();
    assert_eq!(bin_array_0_state.version, v1);

    for bin in bin_array_0_state.bins.iter() {
        assert_eq!(
            bin.liquidity_supply,
            init_liquidity_supply
                .checked_shl(SCALE_OFFSET.into())
                .unwrap()
        );
    }

    let bin_array_1_state: BinArray = banks_client
        .get_account_with_anchor_seder(bin_array_1_pk)
        .await
        .unwrap();

    let v1: u8 = LayoutVersion::V1.into();
    assert_eq!(bin_array_1_state.version, v1);

    for bin in bin_array_1_state.bins.iter() {
        assert_eq!(
            bin.liquidity_supply,
            init_liquidity_supply
                .checked_shl(SCALE_OFFSET.into())
                .unwrap()
        );
    }
}
