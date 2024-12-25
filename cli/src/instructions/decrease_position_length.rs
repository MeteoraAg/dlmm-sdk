use crate::*;
use anchor_client::solana_sdk;

#[derive(Debug, Parser)]
pub struct DecreasePositionLengthParams {
    pub position: Pubkey,
    pub length_to_remove: u16,
    /// 0 = lower, 1 = upper
    pub side: u8,
}

pub async fn execute_decrease_position_length<C: Deref<Target = impl Signer> + Clone>(
    params: DecreasePositionLengthParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let DecreasePositionLengthParams {
        position,
        length_to_remove,
        side,
    } = params;

    let rpc_client = program.async_rpc();
    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(DynamicPosition::deserialize(&account.data)?)
        })
        .await?;

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; DECREASE_POSITION_LENGTH_IX_ACCOUNTS_LEN] =
        DecreasePositionLengthKeys {
            position,
            program: dlmm_interface::ID,
            rent_receiver: position_state.global_data.owner,
            owner: position_state.global_data.owner,
            system_program: solana_sdk::system_program::ID,
            event_authority,
        }
        .into();

    let data = DecreasePositionLengthIxData(DecreasePositionLengthIxArgs {
        length_to_remove,
        side,
    })
    .try_to_vec()?;

    let decrease_length_ix = Instruction {
        program_id: dlmm_interface::ID,
        accounts: accounts.to_vec(),
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(decrease_length_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Decrease position {position} length. Signature: {signature:#?}");

    signature?;

    Ok(())
}
