#![cfg(feature = "alpha-access")]
use std::collections::{BTreeMap, BTreeSet};

use crate::{constants::ALPHA_ACCESS_COLLECTION_MINTS, errors::LBError};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use mpl_token_metadata::accounts::Metadata;

#[derive(Accounts)]
pub struct AlphaAccess<'info> {
    pub access_ticket: Account<'info, TokenAccount>,
    /// CHECK: Will be validated in the handle function
    #[account(
        seeds = [
            "metadata".as_bytes(), 
            mpl_token_metadata::ID.as_ref(),
            access_ticket.mint.as_ref(),
        ],
        bump,
        seeds::program = mpl_token_metadata::ID,
    )]
    pub ticket_metadata: UncheckedAccount<'info>,
}

pub fn validate_alpha_access<'info>(
    owner: Pubkey,
    remaining_accounts: &mut &[AccountInfo<'info>],
) -> Result<()> {
    Ok(())
}
