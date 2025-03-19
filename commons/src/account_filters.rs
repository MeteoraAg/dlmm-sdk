use anchor_client::solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_sdk::pubkey::Pubkey;

pub fn position_filter_by_wallet_and_pair(wallet: Pubkey, pair: Pubkey) -> Vec<RpcFilterType> {
    let position_pair_filter =
        RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &pair.to_bytes()));

    let position_owner_filter = RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
        8 + std::mem::size_of::<Pubkey>(),
        &wallet.to_bytes(),
    ));

    vec![position_pair_filter, position_owner_filter]
}
