use crate::*;

#[derive(Debug, Parser)]
pub struct MigratePositionV3Params {
    pub position: Pubkey,
}

pub async fn execute_migrate_position_v3<C: Deref<Target = impl Signer> + Clone>(
    params: MigratePositionV3Params,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<()> {
    let MigratePositionV3Params { position } = params;

    let rpc_client = program.async_rpc();

    let position_state = rpc_client
        .get_account_and_deserialize(&position, |account| {
            Ok(PositionV2Account::deserialize(&account.data)?.0)
        })
        .await?;

    let lower_bin_array_idx = BinArray::bin_id_to_bin_array_index(position_state.lower_bin_id)?;
    let (lower_bin_array_key, _bump) =
        derive_bin_array_pda(position_state.lb_pair, lower_bin_array_idx.into());
    let (upper_bin_array_key, _bump) =
        derive_bin_array_pda(position_state.lb_pair, (lower_bin_array_idx + 1).into());

    let position_v3_keypair = Keypair::new();
    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; MIGRATE_POSITION_FROM_V2_IX_ACCOUNTS_LEN] =
        MigratePositionFromV2Keys {
            lb_pair: position_state.lb_pair,
            position_v2: position,
            position_v3: position_v3_keypair.pubkey(),
            owner: program.payer(),
            system_program: solana_sdk::system_program::ID,
            program: dlmm_interface::ID,
            bin_array_lower: lower_bin_array_key,
            bin_array_upper: upper_bin_array_key,
            rent_receiver: position_state.owner,
            event_authority,
        }
        .into();

    let data = MigratePositionFromV2IxData.try_to_vec()?;

    let migrate_position_ix = Instruction {
        program_id: dlmm_interface::ID,
        data,
        accounts: accounts.to_vec(),
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(migrate_position_ix)
        .signer(&position_v3_keypair)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Migrate position {}. Signature: {signature:#?}", position);

    signature?;

    Ok(())
}
