use crate::*;
use anchor_client::solana_sdk;

#[derive(Debug, Parser)]
pub struct IncreasePositionLengthParams {
    pub position: Pubkey,
    pub length_to_add: u16,
    /// 0 = lower, 1 = upper
    pub side: u8,
}

pub async fn execute_increase_position_length<C: Deref<Target = impl Signer> + Clone>(
    params: IncreasePositionLengthParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let IncreasePositionLengthParams {
        position,
        length_to_add,
        side,
    } = params;

    let rpc_client = program.async_rpc();
    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(DynamicPosition::deserialize(&account.data)?)
        })
        .await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; INCREASE_POSITION_LENGTH_IX_ACCOUNTS_LEN] =
        IncreasePositionLengthKeys {
            position,
            program: dlmm_interface::ID,
            funder: program.payer(),
            lb_pair: position_state.global_data.lb_pair,
            owner: position_state.global_data.owner,
            system_program: solana_sdk::system_program::ID,
            event_authority,
        }
        .into();

    let data = IncreasePositionLengthIxData(IncreasePositionLengthIxArgs {
        length_to_add,
        side,
    })
    .try_to_vec()?;

    let increase_length_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(increase_length_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Increase position {position} length. Signature: {signature:#?}");

    signature?;

    Ok(())
}
