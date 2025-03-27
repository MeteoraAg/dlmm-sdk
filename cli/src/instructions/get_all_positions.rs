use anchor_client::solana_client::rpc_filter::{Memcmp, RpcFilterType};
use anchor_client::{solana_sdk::signer::Signer, Program};
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use lb_clmm::state::position::PositionV2;
use std::ops::Deref;

pub async fn get_all_positions<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    lb_pair: Pubkey,
    owner: Pubkey,
) -> Result<()> {
    let positions: Vec<(Pubkey, PositionV2)> = program
        .accounts(vec![
            RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8, &lb_pair.to_bytes())),
            RpcFilterType::Memcmp(Memcmp::new_base58_encoded(8 + 32, &owner.to_bytes())),
        ])
        .await?;
    for (key, val) in positions {
        println!("position {} fee owner {}", key, val.fee_owner);
    }
    Ok(())
}
