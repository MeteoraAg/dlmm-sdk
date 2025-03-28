use crate::*;

#[derive(Debug, Parser)]
pub struct InitBinArrayParams {
    /// Index of the bin array.
    #[clap(long, allow_negative_numbers = true)]
    pub bin_array_index: i64,
    /// Address of the liquidity pair.
    pub lb_pair: Pubkey,
}

pub async fn execute_initialize_bin_array<C: Deref<Target = impl Signer> + Clone>(
    params: InitBinArrayParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
) -> Result<Pubkey> {
    let InitBinArrayParams {
        lb_pair,
        bin_array_index,
    } = params;

    let (bin_array, _bump) = derive_bin_array_pda(lb_pair, bin_array_index);

    let accounts = dlmm::client::accounts::InitializeBinArray {
        bin_array,
        funder: program.payer(),
        lb_pair,
        system_program: solana_sdk::system_program::ID,
    }
    .to_account_metas(None);

    let data = dlmm::client::args::InitializeBinArray {
        index: bin_array_index,
    }
    .data();

    let init_bin_array_ix = Instruction {
        program_id: dlmm::ID,
        accounts,
        data,
    };

    let request_builder = program.request();
    let signature = request_builder
        .instruction(init_bin_array_ix)
        .send_with_spinner_and_config(transaction_config)
        .await;

    println!("Initialize Bin Array {bin_array}. Signature: {signature:#?}");

    signature?;

    Ok(bin_array)
}
