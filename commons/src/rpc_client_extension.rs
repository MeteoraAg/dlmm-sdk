use crate::*;
use anchor_client::solana_client::nonblocking::rpc_client::RpcClient;
use async_trait::async_trait;
use solana_sdk::{account::Account, pubkey::Pubkey};

#[async_trait]
pub trait RpcClientExtension {
    async fn get_account_and_deserialize<T>(
        &self,
        pubkey: &Pubkey,
        deserialize_fn: fn(Account) -> Result<T>,
    ) -> Result<T>;
}

#[async_trait]
impl RpcClientExtension for RpcClient {
    async fn get_account_and_deserialize<T>(
        &self,
        pubkey: &Pubkey,
        deserialize_fn: fn(Account) -> Result<T>,
    ) -> Result<T> {
        let account = self.get_account(pubkey).await?;
        let data = deserialize_fn(account)?;
        Ok(data)
    }
}
