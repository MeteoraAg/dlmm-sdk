use crate::*;
use anchor_client::solana_sdk::transaction::Transaction;

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

    let rpc_client = program.async_rpc();

    let pair_account = rpc_client.get_account(&lb_pair).await?;

    let lb_pair_state = LbPairAccount::deserialize(pair_account.data.as_ref())?.0;

    let (base_factor, base_fee_power_factor) =
        compute_base_factor_from_fee_bps(lb_pair_state.bin_step, base_fee_bps)?;

    let ix_data = UpdateBaseFeeParametersIxData(UpdateBaseFeeParametersIxArgs {
        fee_parameter: BaseFeeParameter {
            protocol_share: lb_pair_state.parameters.protocol_share,
            base_factor,
            base_fee_power_factor,
        },
    })
    .try_to_vec()?;

    let event_authority = derive_event_authority_pda().0;

    let accounts: [AccountMeta; UPDATE_BASE_FEE_PARAMETERS_IX_ACCOUNTS_LEN] =
        UpdateBaseFeeParametersKeys {
            lb_pair,
            admin: program.payer(),
            event_authority,
            program: dlmm_interface::ID,
        }
        .into();

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
