use anchor_lang::prelude::Pubkey;
use anchor_lang::Discriminator;
use lb_clmm::state::{bin::BinArray, lb_pair::LbPair, position::Position};
use solana_program_test::ProgramTest;
use solana_sdk::account::Account;

pub fn add_lb_pair_account(test: &mut ProgramTest, state: &LbPair, pk: Pubkey) {
    let mut data = Vec::new();
    data.extend_from_slice(&LbPair::discriminator());
    data.extend_from_slice(bytemuck::bytes_of(state));

    test.add_account(
        pk,
        Account {
            lamports: u32::MAX as u64,
            data,
            owner: lb_clmm::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
}

pub fn add_bin_array_account(test: &mut ProgramTest, state: &BinArray, pk: Pubkey) {
    let mut data = Vec::new();
    data.extend_from_slice(&BinArray::discriminator());
    data.extend_from_slice(bytemuck::bytes_of(state));

    test.add_account(
        pk,
        Account {
            lamports: u32::MAX as u64,
            data,
            owner: lb_clmm::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
}

pub fn add_position_account(test: &mut ProgramTest, state: &Position, pk: Pubkey) {
    let mut data = Vec::new();
    data.extend_from_slice(&Position::discriminator());
    data.extend_from_slice(bytemuck::bytes_of(state));
    test.add_account(
        pk,
        Account {
            lamports: u32::MAX as u64,
            data,
            owner: lb_clmm::ID,
            executable: false,
            rent_epoch: 0,
        },
    );
}
