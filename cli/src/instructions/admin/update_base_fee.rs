use crate::*;

#[derive(Debug, Parser)]
pub struct UpdateBaseFeeParams {
    pub lb_pair: Pubkey,
    pub base_fee_bps: u16,
}

pub async fn execute_update_base_fee<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateBaseFeeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let UpdateBaseFeeParams {
        lb_pair,
        base_fee_bps,
    } = params;

    let rpc_client = program.rpc();

    let pair_account = rpc_client.get_account(&lb_pair).await?;

    let lb_pair_state = LbPair::try_deserialize(&mut pair_account.data.as_ref())?;

    let (base_factor, base_fee_power_factor) =
        compute_base_factor_from_fee_bps(lb_pair_state.bin_step, base_fee_bps)?;

    let ix_data = dlmm::client::args::UpdateBaseFeeParameters {
        fee_parameter: BaseFeeParameter {
            protocol_share: lb_pair_state.parameters.protocol_share,
            base_factor,
            base_fee_power_factor,
        },
    }
    .data();

    let event_authority = derive_event_authority_pda().0;

    let accounts = dlmm::client::accounts::UpdateBaseFeeParameters {
        lb_pair,
        admin: program.payer(),
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: program.id(),
        data: ix_data,
        accounts: accounts.to_vec(),
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Update base fee. Signature: {:#?}", signature);

    signature?;

    Ok(())
}
