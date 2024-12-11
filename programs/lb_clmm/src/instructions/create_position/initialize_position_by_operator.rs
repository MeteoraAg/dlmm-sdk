use crate::state::lb_pair::LbPair;
use crate::state::position::PositionV2;
use crate::utils::seeds;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

#[event_cpi]
#[derive(Accounts)]
#[instruction(lower_bin_id: i32, width: i32)]
pub struct InitializePositionByOperator<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub base: Signer<'info>,
    #[account(
        init,        
        seeds = [
            seeds::POSITION.as_ref(),
            lb_pair.key().as_ref(),
            base.key().as_ref(),
            lower_bin_id.to_le_bytes().as_ref(),
            width.to_le_bytes().as_ref(),
        ],
        bump,
        payer = payer,
        space = 8 + PositionV2::INIT_SPACE,
    )]
    pub position: AccountLoader<'info, PositionV2>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    /// CHECK: owner of position
    pub owner: UncheckedAccount<'info>,

    /// operator
    pub operator: Signer<'info>,

    #[account(
        token::authority = operator,
        token::mint = lb_pair.load()?.token_x_mint,
    )]
    pub operator_token_x: Account<'info, TokenAccount>,

    #[account(
        token::authority = owner,
        token::mint = lb_pair.load()?.token_x_mint,
    )]
    pub owner_token_x: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<InitializePositionByOperator>,
    lower_bin_id: i32,
    width: i32,
    fee_owner: Pubkey,
    lock_release_point: u64,
) -> Result<()> {
    Ok(())
}
