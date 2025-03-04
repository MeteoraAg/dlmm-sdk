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

    let rpc_client = program.async_rpc();
    let account = rpc_client.get_account(&preset_parameter).await?;

    let mut disc = [0u8; 8];
    disc.copy_from_slice(&account.data[..8]);

    match disc {
        PRESET_PARAMETER_ACCOUNT_DISCM => {
            let preset_param_state = PresetParameterAccount::deserialize(&account.data)?.0;
            println!("{:#?}", preset_param_state);
        }
        PRESET_PARAMETER2_ACCOUNT_DISCM => {
            let preset_param_state = PresetParameter2Account::deserialize(&account.data)?.0;
            println!("{:#?}", preset_param_state);
        }
        _ => bail!("Not a valid preset parameter account"),
    }

    Ok(())
}
