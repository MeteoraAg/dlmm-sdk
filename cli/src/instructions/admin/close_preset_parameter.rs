use crate::*;
use anchor_lang::Discriminator;

#[derive(Debug, Parser)]
pub struct ClosePresetAccountParams {
    /// Preset parameter pubkey. Get from ListAllBinStep
    pub preset_parameter: Pubkey,
}

pub async fn execute_close_preset_parameter<C: Deref<Target = impl Signer> + Clone>(
    params: ClosePresetAccountParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let ClosePresetAccountParams { preset_parameter } = params;

    let rpc_client = program.rpc();
    let preset_parameter_account = rpc_client.get_account(&preset_parameter).await?;

    let disc = &preset_parameter_account.data[..8];

    let instruction = if disc == dlmm::accounts::PresetParameter::DISCRIMINATOR {
        let accounts = dlmm::client::accounts::ClosePresetParameter {
            admin: program.payer(),
            rent_receiver: program.payer(),
            preset_parameter,
        }
        .to_account_metas(None);

        let data = dlmm::client::args::ClosePresetParameter {}.data();

        Instruction {
            program_id: dlmm::ID,
            accounts,
            data,
        }
    } else if disc == dlmm::accounts::PresetParameter2::DISCRIMINATOR {
        let accounts = dlmm::client::accounts::ClosePresetParameter2 {
            admin: program.payer(),
            rent_receiver: program.payer(),
            preset_parameter,
        }
        .to_account_metas(None);

        let data = dlmm::client::args::ClosePresetParameter2 {}.data();

        Instruction {
            program_id: dlmm::ID,
            accounts,
            data,
        }
    } else {
        bail!("Not a valid preset parameter account");
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(instruction)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Close preset parameter {}. Signature: {signature:#?}",
        preset_parameter
    );

    signature?;

    Ok(preset_parameter)
}
