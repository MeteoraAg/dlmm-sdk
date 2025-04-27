use anchor_lang::Discriminator;

use crate::*;

#[derive(Debug, Parser)]
pub struct ShowPresetAccountParams {
    pub preset_parameter: Pubkey,
}

pub async fn execute_show_preset_parameters<C: Deref<Target = impl Signer> + Clone>(
    params: ShowPresetAccountParams,
    program: &Program<C>,
) -> Result<()> {
    let ShowPresetAccountParams { preset_parameter } = params;

    let rpc_client = program.rpc();
    let account = rpc_client.get_account(&preset_parameter).await?;

    let mut disc = [0u8; 8];
    disc.copy_from_slice(&account.data[..8]);

    if disc == PresetParameter::DISCRIMINATOR {
        let preset_param_state = PresetParameter::try_deserialize(&mut account.data.as_ref())?;
        println!("{:#?}", preset_param_state);
    } else if disc == PresetParameter2::DISCRIMINATOR {
        let preset_param_state: PresetParameter2 = bytemuck::pod_read_unaligned(&account.data[8..]);
        println!("{:#?}", preset_param_state);
    } else {
        bail!("Not a valid preset parameter account");
    }

    Ok(())
}
