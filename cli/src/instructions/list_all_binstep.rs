use anchor_client::{solana_sdk::signer::Signer, Program};
use lb_clmm::constants::FEE_PRECISION;
use lb_clmm::state::preset_parameters::PresetParameter;
use std::ops::Deref;

use anyhow::*;

pub async fn list_all_binstep<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
) -> Result<()> {
    let preset_parameters = program.accounts::<PresetParameter>(vec![]).await?;

    for (key, param) in preset_parameters {
        let base_fee = (param.bin_step as u128 * param.base_factor as u128 * 1000) as f64
            / FEE_PRECISION as f64;
        println!(
            "Preset Pubkey: {}. Bin step {}. Base fee: {}%",
            key, param.bin_step, base_fee
        );
    }

    Ok(())
}
