use crate::errors::LBError;
use crate::state::token_badge::TokenBadge;
use anchor_lang::prelude::*;
use anchor_spl::{
    token::Token,
    token_2022::spl_token_2022::{
        self,
        extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
    },
    token_interface::Mint,
};

pub fn validate_mint<'info>(
    mint_account: &InterfaceAccount<Mint>,
    token_badge: &Option<AccountLoader<'info, TokenBadge>>,
) -> Result<()> {
    let mint_info = mint_account.to_account_info();

    if *mint_info.owner == Token::id() {
        return Ok(());
    }
    match token_badge {
        Some(account) => {
            let token_badge = account.load()?;
            if token_badge.token_mint == mint_account.key() {
                Ok(())
            } else {
                Err(LBError::UnmatchTokenMint.into())
            }
        }
        None => {
            let mint_data = mint_info.try_borrow_data()?;
            let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
            let extensions = mint.get_extension_types()?;
            for e in extensions {
                if e != ExtensionType::MetadataPointer && e != ExtensionType::TokenMetadata {
                    return Err(LBError::UnsupportedMintExtension.into());
                }
            }
            Ok(())
        }
    }
}
