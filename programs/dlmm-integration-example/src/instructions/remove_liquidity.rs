use crate::instructions::add_liquidity::ModifyLiquidity;
use anchor_lang::context::Context;
use anchor_lang::prelude::*;
use dlmm_program_interface::cpi::accounts::ModifyLiquidity as DlmmRemoveLiquidity;
use dlmm_program_interface::instructions::remove_liquidity::BinLiquidityReduction;

pub trait LiquidityReduction {
    fn get_position_liquidity_reduction(
        &self,
        withdraw_percentage: u8,
    ) -> Result<Vec<BinLiquidityReduction>>;
}

impl<'info> LiquidityReduction for ModifyLiquidity<'info> {
    fn get_position_liquidity_reduction(
        &self,
        withdraw_percentage: u8,
    ) -> Result<Vec<BinLiquidityReduction>> {
        let withdraw_percentage = std::cmp::min(100, withdraw_percentage);

        let position = self.position.load()?;
        let mut reductions = vec![];

        for bin_id in position.lower_bin_id..=position.upper_bin_id {
            let reduction = BinLiquidityReduction {
                bin_id,
                bps_to_remove: 10000 * withdraw_percentage as u16 / 100,
            };

            reductions.push(reduction);
        }

        Ok(reductions)
    }
}

pub fn handle(ctx: Context<ModifyLiquidity>, withdraw_percentage: u8) -> Result<()> {
    let reductions = ctx
        .accounts
        .get_position_liquidity_reduction(withdraw_percentage)?;

    let manager = ctx.accounts.position_manager.load()?;

    let seeds = [
        manager.lb_pair.as_ref(),
        manager.owner.as_ref(),
        &[manager.bump],
    ];

    let cpi_accounts = DlmmRemoveLiquidity {
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

    dlmm_program_interface::cpi::remove_liquidity(cpi, reductions)
}
