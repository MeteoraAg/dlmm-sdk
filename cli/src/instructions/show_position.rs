use anchor_lang::Discriminator;

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

    let rpc_client = program.rpc();
    let position_account = rpc_client.get_account(&position).await?;

    let mut disc = [0u8; 8];
    disc.copy_from_slice(&position_account.data[..8]);

    if disc == Position::DISCRIMINATOR {
        let position_state: Position = bytemuck::pod_read_unaligned(&position_account.data[8..]);
        println!("{:#?}", position_state);
    } else if disc == PositionV2::DISCRIMINATOR {
        let position_state: PositionV2 = bytemuck::pod_read_unaligned(&position_account.data[8..]);
        println!("{:#?}", position_state);
    } else {
        bail!("Not a valid position account");
    };

    Ok(())
}
