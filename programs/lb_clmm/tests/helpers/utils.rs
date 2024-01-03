use anchor_lang::solana_program::{
    hash::Hash, instruction::Instruction, program_option::COption, program_pack::Pack,
    pubkey::Pubkey, system_instruction,
};
use anchor_lang::AccountDeserialize;
use assert_matches::assert_matches;
use async_trait::async_trait;
use solana_program_test::BanksClient;
use solana_sdk::{
    account::Account,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

pub async fn process_and_assert_ok(
    instructions: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
    banks_client: &mut BanksClient,
) {
    let recent_blockhash = banks_client.get_latest_blockhash().await.unwrap();

    let mut all_signers = vec![payer];
    all_signers.extend_from_slice(signers);

    let tx = Transaction::new_signed_with_payer(
        &instructions,
        Some(&payer.pubkey()),
        &all_signers,
        recent_blockhash,
    );

    assert_matches!(banks_client.process_transaction(tx).await, Ok(()));
}

#[async_trait]
pub trait AnchorAdapter {
    async fn get_account_with_anchor_seder<T: AccountDeserialize>(
        &mut self,
        address: Pubkey,
    ) -> Option<T>;
}
#[async_trait]
impl AnchorAdapter for BanksClient {
    async fn get_account_with_anchor_seder<T: AccountDeserialize>(
        &mut self,
        address: Pubkey,
    ) -> Option<T> {
        let account = self.get_account(address).await.unwrap()?;
        T::try_deserialize(&mut account.data.as_ref()).ok()
    }
}
