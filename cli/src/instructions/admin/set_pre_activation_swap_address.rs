use crate::*;

#[derive(Debug, Parser)]
pub struct SetPreactivationSwapAddressParam {
    pub lb_pair: Pubkey,
    pub pre_activation_swap_address: Pubkey,
}

pub async fn execute_set_pre_activation_swap_address<C: Deref<Target = impl Signer> + Clone>(
    params: SetPreactivationSwapAddressParam,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let SetPreactivationSwapAddressParam {
        lb_pair,
        pre_activation_swap_address,
    } = params;

    let accounts = dlmm::client::accounts::SetPreActivationSwapAddress {
        creator: program.payer(),
        lb_pair,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::SetPreActivationSwapAddress {
        pre_activation_swap_address,
    }
    .data();

    let set_pre_activation_swap_address_ix = Instruction {
        accounts,
        data,
        program_id: dlmm::ID,
    };

    let request_builder = program.request();

    let signature = request_builder
        .instruction(set_pre_activation_swap_address_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Set pre activation swap address. Signature: {:#?}",
        signature
    );

    signature?;

    Ok(())
}
