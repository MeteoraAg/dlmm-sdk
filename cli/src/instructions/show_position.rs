use crate::*;

#[derive(Debug, Parser)]
pub struct ShowPositionParams {
    pub position: Pubkey,
}

pub async fn execute_show_position<C: Deref<Target = impl Signer> + Clone>(
    params: ShowPositionParams,
    program: &Program<C>,
) -> Result<()> {
    let ShowPositionParams { position } = params;

    let rpc_client = program.async_rpc();
    let position_account = rpc_client.get_account(&position).await?;

    let mut disc = [0u8; 8];
    disc.copy_from_slice(&position_account.data[..8]);

    match disc {
        POSITION_ACCOUNT_DISCM => {
            let position_state = PositionAccount::deserialize(&position_account.data)?.0;
            println!("{:#?}", position_state);
        }
        POSITION_V2_ACCOUNT_DISCM => {
            let position_state = PositionV2Account::deserialize(&position_account.data)?.0;
            println!("{:#?}", position_state);
        }
        _ => {
            bail!("Not a valid position account");
        }
    };

    Ok(())
}
