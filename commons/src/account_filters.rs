use anchor_client::solana_client::rpc_filter::{Memcmp, RpcFilterType};
use anchor_lang::Discriminator;
use solana_sdk::pubkey::Pubkey;

use crate::dlmm::accounts::LimitOrder;

pub fn position_filter_by_wallet_and_pair(wallet: Pubkey, pair: Pubkey) -> Vec<RpcFilterType> {
    let position_pair_filter =
        RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &pair.to_bytes()));

    let position_owner_filter = RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
        8 + std::mem::size_of::<Pubkey>(),
        &wallet.to_bytes(),
    ));

    vec![position_pair_filter, position_owner_filter]
}

pub fn limit_order_filter_by_owner_and_pair(
    owner: Pubkey,
    pair: Pubkey,
) -> Vec<RpcFilterType> {
    let discriminator_filter =
        RpcFilterType::Memcmp(Memcmp::new_base58_encoded(0, &LimitOrder::DISCRIMINATOR));

    let pair_filter = RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &pair.to_bytes()));

    let owner_filter = RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
        8 + std::mem::size_of::<Pubkey>(),
        &owner.to_bytes(),
    ));

    vec![discriminator_filter, pair_filter, owner_filter]
}
