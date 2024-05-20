use super::deposit::add_liquidity::ModifyLiquidity;
use crate::constants::BASIS_POINT_MAX;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::state::dynamic_position::DynamicPosition;
use crate::state::dynamic_position::DynamicPositionLoader;
use crate::BinArrayAccount;
use crate::PositionLiquidityFlowValidator;
use crate::{
    errors::LBError, events::RemoveLiquidity as RemoveLiquidityEvent, math::safe_math::SafeMath,
};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::TransferChecked;
use ruint::aliases::U256;
use std::collections::{BTreeMap, BTreeSet};
#[derive(AnchorSerialize, AnchorDeserialize, Debug, Clone)]
pub struct BinLiquidityReduction {
    pub bin_id: i32,
    pub bps_to_remove: u16,
}

impl<'a, 'b, 'c, 'info> PositionLiquidityFlowValidator for ModifyLiquidity<'info> {
    fn validate_outflow_to_ata_of_position_owner(&self, owner: Pubkey) -> Result<()> {
        let dest_token_x = anchor_spl::associated_token::get_associated_token_address(
            &owner,
            &self.token_x_mint.key(),
        );
        require!(
            dest_token_x == self.user_token_x.key() && self.user_token_x.owner == owner,
            LBError::WithdrawToWrongTokenAccount
        );
        let dest_token_y = anchor_spl::associated_token::get_associated_token_address(
            &owner,
            &self.token_y_mint.key(),
        );
        require!(
            dest_token_y == self.user_token_y.key() && self.user_token_y.owner == owner,
            LBError::WithdrawToWrongTokenAccount
        );
        Ok(())
    }
}

pub trait RemoveLiquidity {
    fn transfer_to_user(&self, amount_x: u64, amount_y: u64) -> Result<()>;
}

impl<'a, 'b, 'c, 'info> RemoveLiquidity for Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>> {
    fn transfer_to_user(&self, amount_x: u64, amount_y: u64) -> Result<()> {
        let lb_pair = self.accounts.lb_pair.load()?;
        let signer_seeds = &[&lb_pair.seeds()?[..]];

        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.accounts.token_x_program.to_account_info(),
                TransferChecked {
                    from: self.accounts.reserve_x.to_account_info(),
                    to: self.accounts.user_token_x.to_account_info(),
                    authority: self.accounts.lb_pair.to_account_info(),
                    mint: self.accounts.token_x_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount_x,
            self.accounts.token_x_mint.decimals,
        )?;

        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.accounts.token_y_program.to_account_info(),
                TransferChecked {
                    from: self.accounts.reserve_y.to_account_info(),
                    to: self.accounts.user_token_y.to_account_info(),
                    authority: self.accounts.lb_pair.to_account_info(),
                    mint: self.accounts.token_y_mint.to_account_info(),
                },
                signer_seeds,
            ),
            amount_y,
            self.accounts.token_y_mint.decimals,
        )
    }
}

pub fn calculate_shares_to_remove(
    bps: u16,
    bin_id: i32,
    position: &DynamicPosition,
) -> Result<u128> {
    let share_in_bin = U256::from(position.get_liquidity_share_in_bin(bin_id)?);

    let share_to_remove: u128 = U256::from(bps)
        .safe_mul(share_in_bin)?
        .safe_div(U256::from(BASIS_POINT_MAX))?
        .try_into()
        .map_err(|_| LBError::TypeCastFailed)?;
    Ok(share_to_remove)
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    bin_liquidity_reduction: Vec<BinLiquidityReduction>,
) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ix_size_reduction() {
        let max_tx_size = 1232; // 1232 bytes
        let signature_size = 64; // 64 bytes
        let account_size = 32; // 32 bytes
        let anchor_disc_size = 8;

        let remove_liquidity_account_count = 13;
        let remove_liquidity_signature_count = 1;

        let base_tx_size = signature_size * remove_liquidity_signature_count
            + remove_liquidity_account_count * account_size;

        let bin_ids = vec![0i32];
        let liquidities_to_remove = vec![0u128];

        let bin_ids_size = borsh::to_vec(&bin_ids).unwrap().len();
        let liquidities_to_remove_size = borsh::to_vec(&liquidities_to_remove).unwrap().len();

        let ix_data_with_u256 = anchor_disc_size + bin_ids_size + liquidities_to_remove_size;

        let bps_to_remove = vec![0u16];
        let bps_to_remove_size = borsh::to_vec(&bps_to_remove).unwrap().len();

        let ix_data_with_bps = anchor_disc_size + bin_ids_size + bps_to_remove_size;

        assert_eq!(ix_data_with_bps < ix_data_with_u256, true);

        let delta = ix_data_with_u256 - ix_data_with_bps;
        let pct = delta * 100 / ix_data_with_u256;

        println!("Reduced {}%", pct);

        let remaining_size = max_tx_size - base_tx_size - anchor_disc_size;
        let no_of_bin_can_fit = remaining_size / (bin_ids_size + bps_to_remove_size);

        println!(
            "Estimated number of bins can be withdrawn {}",
            no_of_bin_can_fit
        );
    }
}
