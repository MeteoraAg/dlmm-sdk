use crate::state::position_manager::PositionManager;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use dlmm_program_interface::cpi::accounts::ModifyLiquidity as DlmmAddLiquidity;
use dlmm_program_interface::instructions::add_liquidity::BinLiquidityDistribution;
use dlmm_program_interface::{
    instructions::add_liquidity::LiquidityParameter,
    program::Dlmm,
    state::{
        bin::BinArray, bin_array_bitmap_extension::BinArrayBitmapExtension, lb_pair::LbPair,
        position::Position,
    },
};

pub trait DistributionShape {
    fn get_spot_distribution(&self) -> Result<Vec<BinLiquidityDistribution>>;
}

#[derive(Accounts)]
pub struct ModifyLiquidity<'info> {
    #[account(
        mut,
        constraint = position.load().unwrap().owner == position_manager.key(),
    )]
    pub position: AccountLoader<'info, Position>,

    #[account(
        has_one = lb_pair,
        has_one = owner
    )]
    pub position_manager: AccountLoader<'info, PositionManager>,

    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(mut)]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(
        mut,
        token::mint = token_x_mint
    )]
    pub user_token_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        token::mint = token_y_mint
    )]
    pub user_token_y: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub reserve_x: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub reserve_y: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_x_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_y_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub bin_array_lower: AccountLoader<'info, BinArray>,
    #[account(mut)]
    pub bin_array_upper: AccountLoader<'info, BinArray>,

    pub owner: Signer<'info>,

    /// CHECK: Event authority
    pub event_authority: UncheckedAccount<'info>,

    pub dlmm_program: Program<'info, Dlmm>,
    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,
}

impl<'info> DistributionShape for ModifyLiquidity<'info> {
    fn get_spot_distribution(&self) -> Result<Vec<BinLiquidityDistribution>> {
        let position = self.position.load()?;
        let lower_bin_id = position.lower_bin_id;
        let upper_bin_id = position.upper_bin_id;

        let lb_pair = self.lb_pair.load()?;
        let active_id = lb_pair.active_id;

        let bid_sides = active_id.saturating_sub(lower_bin_id);
        let ask_sides = upper_bin_id.saturating_sub(active_id);

        let bps_per_bid_bins = if bid_sides > 0 {
            1000000 / (bid_sides * 100 + 50)
        } else {
            0
        };
        let bps_per_ask_bins = if ask_sides > 0 {
            1000000 / (ask_sides * 100 + 50)
        } else {
            0
        };

        let total_bps_per_bid_bins = bps_per_bid_bins * bid_sides;
        let total_bps_per_ask_bins = bps_per_ask_bins * ask_sides;

        let bps_in_active_bin_bid = 10000 - total_bps_per_bid_bins;
        let bps_in_active_bin_ask = 10000 - total_bps_per_ask_bins;

        let mut liquidity_distributions = vec![];
        for bin_id in position.lower_bin_id..=position.upper_bin_id {
            let dist = if bin_id < active_id {
                BinLiquidityDistribution {
                    bin_id,
                    distribution_x: 0,
                    distribution_y: bps_per_ask_bins as u16,
                }
            } else if bin_id > active_id {
                BinLiquidityDistribution {
                    bin_id,
                    distribution_x: bps_per_bid_bins as u16,
                    distribution_y: 0,
                }
            } else {
                BinLiquidityDistribution {
                    bin_id,
                    distribution_x: bps_in_active_bin_bid as u16,
                    distribution_y: bps_in_active_bin_ask as u16,
                }
            };

            liquidity_distributions.push(dist);
        }

        Ok(liquidity_distributions)
    }
}

pub fn handle(ctx: Context<ModifyLiquidity>, amount_x: u64, amount_y: u64) -> Result<()> {
    let manager = ctx.accounts.position_manager.load()?;

    let seeds = [
        manager.lb_pair.as_ref(),
        manager.owner.as_ref(),
        &[manager.bump],
    ];

    let cpi_accounts = DlmmAddLiquidity {
        lb_pair: ctx.accounts.lb_pair.to_account_info(),
        event_authority: ctx.accounts.event_authority.to_account_info(),
        owner: ctx.accounts.position_manager.to_account_info(),
        position: ctx.accounts.position.to_account_info(),
        program: ctx.accounts.dlmm_program.to_account_info(),
        bin_array_bitmap_extension: ctx
            .accounts
            .bin_array_bitmap_extension
            .as_ref()
            .and_then(|b| Some(b.to_account_info())),
        bin_array_lower: ctx.accounts.bin_array_lower.to_account_info(),
        bin_array_upper: ctx.accounts.bin_array_upper.to_account_info(),
        reserve_x: ctx.accounts.reserve_x.to_account_info(),
        reserve_y: ctx.accounts.reserve_y.to_account_info(),
        token_x_mint: ctx.accounts.token_x_mint.to_account_info(),
        token_x_program: ctx.accounts.token_x_program.to_account_info(),
        token_y_mint: ctx.accounts.token_y_mint.to_account_info(),
        token_y_program: ctx.accounts.token_y_program.to_account_info(),
        user_token_x: ctx.accounts.user_token_x.to_account_info(),
        user_token_y: ctx.accounts.user_token_y.to_account_info(),
    };

    let signer_seeds = &[&seeds[..]];

    let cpi = CpiContext::new_with_signer(
        ctx.accounts.dlmm_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );

    let liquidity_parameter = LiquidityParameter {
        amount_x,
        amount_y,
        bin_liquidity_dist: ctx.accounts.get_spot_distribution()?,
    };

    dlmm_program_interface::cpi::add_liquidity(cpi, liquidity_parameter)
}
