use crate::*;

#[derive(Debug, Parser)]
pub struct InitPositionParams {
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
    /// Lower bound of the bin range.
    #[clap(long, allow_negative_numbers = true)]
    pub lower_bin_id: i32,
    /// Width of the position. Start with 1 until 70.
    pub width: i32,
}

pub async fn execute_initialize_position<C: Deref<Target = impl Signer> + Clone>(
    params: InitPositionParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitPositionParams {
        lb_pair,
        lower_bin_id,
        width,
    } = params;

    let position_keypair = Keypair::new();

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts: [AccountMeta; INITIALIZE_POSITION_IX_ACCOUNTS_LEN] = InitializePositionKeys {
        lb_pair,
        payer: program.payer(),
        position: position_keypair.pubkey(),
        owner: program.payer(),
        rent: solana_sdk::sysvar::rent::ID,
        system_program: solana_sdk::system_program::ID,
        event_authority,
        program: dlmm_interface::ID,
    }
    .into();

    let data = InitializePositionIxData(InitializePositionIxArgs {
        lower_bin_id,
        width,
    })
    .try_to_vec()?;

    let init_position_ix = Instruction {
        program_id: dlmm_interface::ID,
        data,
        accounts: accounts.to_vec(),
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(init_position_ix)
        .signer(&position_keypair)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Initialize position {}. Signature: {signature:#?}",
        position_keypair.pubkey()
    );

    signature?;

    Ok(position_keypair.pubkey())
}
