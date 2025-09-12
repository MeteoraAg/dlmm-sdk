use crate::*;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};

#[derive(Debug, Parser)]
pub struct GetAllPositionsParams {
    /// Address of the pair
    #[clap(long)]
    lb_pair: Pubkey,
    /// Owner of position
    #[clap(long)]
    owner: Pubkey,
}

pub async fn execute_get_all_positions<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    params: GetAllPositionsParams,
) -> Result<()> {
    let GetAllPositionsParams { lb_pair, owner } = params;

    let rpc_client = program.rpc();

    let account_config = RpcAccountInfoConfig {
        encoding: Some(UiAccountEncoding::Base64),
        ..Default::default()
    };
    let config = RpcProgramAccountsConfig {
        filters: Some(position_filter_by_wallet_and_pair(owner, lb_pair)),
        account_config,
        ..Default::default()
    };

    let accounts = rpc_client
        .get_program_accounts_with_config(&dlmm::ID, config)
        .await?;

    for (position_key, position_raw_account) in accounts {
        let position_state: PositionV2 =
            bytemuck::pod_read_unaligned(&position_raw_account.data[8..]);
        println!(
            "Position {} fee owner {}",
            position_key, position_state.fee_owner
        );
    }

    Ok(())
}
