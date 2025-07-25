use std::sync::Arc;

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

    let position_keypair = Arc::new(Keypair::new());

    let (event_authority, _bump) = derive_event_authority_pda();

    let accounts = dlmm::client::accounts::InitializePosition {
        lb_pair,
        payer: program.payer(),
        position: position_keypair.pubkey(),
        owner: program.payer(),
        rent: solana_sdk::sysvar::rent::ID,
        system_program: solana_sdk::system_program::ID,
        event_authority,
        program: dlmm::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::InitializePosition {
        lower_bin_id,
        width,
    }
    .data();

    let init_position_ix = Instruction {
        program_id: dlmm::ID,
        data,
        accounts,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(init_position_ix)
        .signer(position_keypair.clone())
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!(
        "Initialize position {}. Signature: {signature:#?}",
        position_keypair.pubkey()
    );

    signature?;

    Ok(position_keypair.pubkey())
}
