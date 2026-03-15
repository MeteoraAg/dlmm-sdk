use std::collections::HashMap;

use anchor_lang::Discriminator;

use crate::*;
use commons::extensions::dynamic_position::DynamicPosition;

#[derive(Debug, Parser)]
pub struct ShowPositionParams {
    pub position: Pubkey,
}

pub async fn execute_show_position<C: Deref<Target = impl Signer> + Clone>(
    params: ShowPositionParams,
    program: &Program<C>,
) -> Result<()> {
    let ShowPositionParams { position } = params;

    let rpc_client = program.rpc();
    let position_account = rpc_client.get_account(&position).await?;

    let mut disc = [0u8; 8];
    disc.copy_from_slice(&position_account.data[..8]);

    if disc != PositionV2::DISCRIMINATOR {
        bail!("Not a valid position account");
    }

    let position_state: PositionV2 = pod_read_unaligned_skip_disc(&position_account.data)?;

    // Derive bin array coverage from actual lower/upper bin IDs
    let lower_bin_array_index = BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
    let upper_bin_array_index = BinArray::bin_id_to_bin_array_index(position_state.upper_bin_id)?;

    let bin_array_pubkeys: Vec<Pubkey> = (lower_bin_array_index..=upper_bin_array_index)
        .map(|idx| derive_bin_array_pda(position_state.lb_pair, idx.into()).0)
        .collect();

    // Fetch lb_pair, clock, and all bin arrays
    let accounts_to_fetch: Vec<Pubkey> = [
        vec![position_state.lb_pair, solana_sdk::sysvar::clock::ID],
        bin_array_pubkeys,
    ]
    .concat();

    let fetched = rpc_client.get_multiple_accounts(&accounts_to_fetch).await?;

    let lb_pair_account = fetched[0]
        .as_ref()
        .context("Failed to fetch lb pair account")?;
    let lb_pair_state: LbPair = pod_read_unaligned_skip_disc(&lb_pair_account.data)?;

    let clock_account = fetched[1]
        .as_ref()
        .context("Failed to fetch clock account")?;
    let clock: solana_sdk::sysvar::clock::Clock =
        bincode::deserialize(clock_account.data.as_ref())?;

    let mut bin_array_map: HashMap<i32, BinArray> = HashMap::new();
    for (i, idx) in (lower_bin_array_index..=upper_bin_array_index).enumerate() {
        if let Some(account) = &fetched[2 + i] {
            let bin_array: BinArray = pod_read_unaligned_skip_disc(&account.data)?;
            bin_array_map.insert(idx, bin_array);
        }
    }

    let dynamic_position = DynamicPosition::parse(
        &position_state,
        &position_account.data,
        &lb_pair_state,
        &bin_array_map,
        clock.unix_timestamp,
    )?;

    println!("{}", dynamic_position);

    Ok(())
}
