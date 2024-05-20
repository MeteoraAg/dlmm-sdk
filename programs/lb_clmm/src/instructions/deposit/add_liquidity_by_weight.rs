use crate::errors::LBError;
use crate::handle_deposit_by_amounts;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::weight_to_amounts::{to_amount_both_side, AmountInBin};
use crate::BinArrayAccount;
use crate::ModifyLiquidity;
use anchor_lang::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug, Default)]
pub struct BinLiquidityDistributionByWeight {
    /// Define the bin ID wish to deposit to.
    pub bin_id: i32,
    /// weight of liquidity distributed for this bin id
    pub weight: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityParameterByWeight {
    /// Amount of X token to deposit
    pub amount_x: u64,
    /// Amount of Y token to deposit
    pub amount_y: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
}

impl LiquidityParameterByWeight {
    fn bin_count(&self) -> u32 {
        self.bin_liquidity_dist.len() as u32
    }

    pub fn validate<'a, 'info>(&'a self, active_id: i32) -> Result<()> {
        let bin_count = self.bin_count();
        require!(bin_count > 0, LBError::InvalidInput);

        let bin_shift = if active_id > self.active_id {
            active_id - self.active_id
        } else {
            self.active_id - active_id
        };

        require!(
            bin_shift <= self.max_active_bin_slippage.into(),
            LBError::ExceededBinSlippageTolerance
        );

        // bin dist must be in consecutive order and weight is non-zero
        for (i, val) in self.bin_liquidity_dist.iter().enumerate() {
            require!(val.weight != 0, LBError::InvalidInput);
            // bin id must in right order
            if i != 0 {
                require!(
                    val.bin_id > self.bin_liquidity_dist[i - 1].bin_id,
                    LBError::InvalidInput
                );
            }
        }
        let first_bin_id = self.bin_liquidity_dist[0].bin_id;
        let last_bin_id = self.bin_liquidity_dist[self.bin_liquidity_dist.len() - 1].bin_id;

        if first_bin_id > active_id {
            require!(self.amount_x != 0, LBError::InvalidInput);
        }
        if last_bin_id < active_id {
            require!(self.amount_y != 0, LBError::InvalidInput);
        }

        Ok(())
    }

    pub fn is_include_bin_id(&self, bin_id: i32) -> bool {
        for bin_dist in self.bin_liquidity_dist.iter() {
            if bin_dist.bin_id == bin_id {
                return true;
            }
        }
        false
    }
    // require bin id to be sorted before doing this
    pub fn to_amounts_into_bin<'a, 'info>(
        &'a self,
        active_id: i32,
        bin_step: u16,
        amount_x_in_active_bin: u64, // amount x in active bin
        amount_y_in_active_bin: u64, // amount y in active bin
    ) -> Result<Vec<AmountInBin>> {
        to_amount_both_side(
            active_id,
            bin_step,
            amount_x_in_active_bin,
            amount_y_in_active_bin,
            self.amount_x,
            self.amount_y,
            &self
                .bin_liquidity_dist
                .iter()
                .map(|x| (x.bin_id, x.weight))
                .collect::<Vec<(i32, u16)>>(),
        )
    }
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    liquidity_parameter: &LiquidityParameterByWeight,
) -> Result<()> {
    Ok(())
}

pub fn find_amount_in_active_bin<'a>(
    lb_pair_pk: Pubkey,
    active_id: i32,
    remaining_accounts: &mut &[AccountInfo<'a>],
) -> Result<(u64, u64)> {
    let amount_x;
    let amount_y;
    loop {
        let bin_array_account = BinArrayAccount::try_accounts(
            &crate::ID,
            remaining_accounts,
            &[],
            &mut BTreeMap::new(),
            &mut BTreeSet::new(),
        )?;
        let mut bin_arrays = [bin_array_account.load_and_validate(lb_pair_pk)?];
        let bin_array_manager = BinArrayManager::new(&mut bin_arrays)?;
        if let Ok(bin) = bin_array_manager.get_bin(active_id) {
            amount_x = bin.amount_x;
            amount_y = bin.amount_y;
            break;
        };
    }
    Ok((amount_x, amount_y))
}
