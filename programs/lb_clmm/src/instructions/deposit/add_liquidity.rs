use crate::authorize_modify_position;
use crate::constants::BASIS_POINT_MAX;
use crate::errors::LBError;
use crate::events::{AddLiquidity as AddLiquidityEvent, CompositionFee};
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::bin_math::get_liquidity;
use crate::math::safe_math::SafeMath;
use crate::math::weight_to_amounts::AmountInBin;
use crate::state::action_access::get_lb_pair_type_access_validator;
use crate::state::bin::{get_liquidity_share, get_out_amount, Bin};
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::dynamic_position::{DynamicPosition, DynamicPositionLoader, PositionV3};
use crate::state::lb_pair::LbPair;
use crate::BinArrayAccount;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::TransferChecked;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num_traits::Zero;
use std::cell::RefMut;
use std::collections::{BTreeMap, BTreeSet};

pub struct CompositeDepositInfo {
    pub liquidity_share: u128,
    pub protocol_token_x_fee_amount: u64,
    pub protocol_token_y_fee_amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct BinLiquidityDistribution {
    /// Define the bin ID wish to deposit to.
    pub bin_id: i32,
    /// DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.
    pub distribution_x: u16,
    /// DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.
    pub distribution_y: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityParameter {
    /// Amount of X token to deposit
    pub amount_x: u64,
    /// Amount of Y token to deposit
    pub amount_y: u64,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistribution>,
}

impl LiquidityParameter {
    fn bin_count(&self) -> u32 {
        self.bin_liquidity_dist.len() as u32
    }

    fn validate<'a, 'info>(&'a self, position_width: u64) -> Result<()> {
        let bin_count = self.bin_count();
        require!(bin_count > 0, LBError::InvalidInput);

        require!(bin_count as u64 <= position_width, LBError::InvalidInput);

        let mut sum_x_distribution = 0u32;
        let mut sum_y_distribution = 0u32;
        for bin_dist in self.bin_liquidity_dist.iter() {
            sum_x_distribution = sum_x_distribution.safe_add(bin_dist.distribution_x.into())?;
            sum_y_distribution = sum_y_distribution.safe_add(bin_dist.distribution_y.into())?;
        }

        // bin dist must be in consecutive order
        for (i, val) in self.bin_liquidity_dist.iter().enumerate() {
            // bin id must in right order
            if i != 0 {
                require!(
                    val.bin_id > self.bin_liquidity_dist[i - 1].bin_id,
                    LBError::InvalidInput
                );
            }
        }

        require!(
            sum_x_distribution <= BASIS_POINT_MAX as u32,
            LBError::InvalidInput
        );

        require!(
            sum_y_distribution <= BASIS_POINT_MAX as u32,
            LBError::InvalidInput
        );

        Ok(())
    }
}

pub trait AddLiquidity {
    fn transfer_to_reserve_x(&self, amount_x: u64) -> Result<()>;
    fn transfer_to_reserve_y(&self, amount_y: u64) -> Result<()>;
}

impl<'a, 'b, 'c, 'info> AddLiquidity for Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>> {
    fn transfer_to_reserve_x(&self, amount_x: u64) -> Result<()> {
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new(
                self.accounts.token_x_program.to_account_info(),
                TransferChecked {
                    from: self.accounts.user_token_x.to_account_info(),
                    to: self.accounts.reserve_x.to_account_info(),
                    authority: self.accounts.sender.to_account_info(),
                    mint: self.accounts.token_x_mint.to_account_info(),
                },
            ),
            amount_x,
            self.accounts.token_x_mint.decimals,
        )
    }

    fn transfer_to_reserve_y(&self, amount_y: u64) -> Result<()> {
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new(
                self.accounts.token_y_program.to_account_info(),
                TransferChecked {
                    from: self.accounts.user_token_y.to_account_info(),
                    to: self.accounts.reserve_y.to_account_info(),
                    authority: self.accounts.sender.to_account_info(),
                    mint: self.accounts.token_y_mint.to_account_info(),
                },
            ),
            amount_y,
            self.accounts.token_y_mint.decimals,
        )
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct ModifyLiquidity<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, PositionV3>,

    #[account(
        mut,
        has_one = reserve_x,
        has_one = reserve_y,
        has_one = token_x_mint,
        has_one = token_y_mint,
    )]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
    )]
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

    pub sender: Signer<'info>,
    pub token_x_program: Interface<'info, TokenInterface>,
    pub token_y_program: Interface<'info, TokenInterface>,
}

pub struct DepositBinInfo {
    /// Token X amount to be deposited into the bin
    pub amount_x_into_bin: u64,
    /// Token Y amount to be deposited into the bin
    pub amount_y_into_bin: u64,
    /// Token X amount if immediately withdraw
    pub out_amount_x: u64,
    /// Token Y amount if immediately withdraw
    pub out_amount_y: u64,
    /// Total share deposited into the bin based on in_amount_x and in_amount_y.
    pub liquidity_share: u128,
    /// Liquidity of the bin
    pub bin_liquidity: u128,
    /// Price of the bin
    pub bin_price: u128,
}

pub fn handle<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    liquidity_parameter: LiquidityParameter,
) -> Result<()> {
    Ok(())
}

/// handle deposit both side
pub fn handle_deposit_by_amounts<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidity<'info>>,
    amounts_in_bin: &[AmountInBin], // vec of bin id and amount
) -> Result<()> {
    Ok(())
}

/// Get token X, Y amount if withdraw immediately upon deposit
pub fn get_out_amount_after_deposit(
    liquidity_share: u128,
    in_amount_x: u64,
    in_amount_y: u64,
    bin: &Bin,
) -> Result<(u64, u64)> {
    let out_amount_x: u64 = get_out_amount(
        liquidity_share,
        in_amount_x.safe_add(bin.amount_x)?,
        bin.liquidity_supply.safe_add(liquidity_share)?,
    )?;

    let out_amount_y: u64 = get_out_amount(
        liquidity_share,
        in_amount_y.safe_add(bin.amount_y)?,
        bin.liquidity_supply.safe_add(liquidity_share)?,
    )?;

    Ok((out_amount_x, out_amount_y))
}

/// Charge protocol fee from composition fee.
pub fn charge_protocol_fee(
    lb_pair: &mut RefMut<'_, LbPair>,
    composition_fee_x: u64,
    composition_fee_y: u64,
) -> Result<(u64, u64)> {
    let protocol_fee_x = lb_pair.compute_protocol_fee(composition_fee_x)?;
    let protocol_fee_y = lb_pair.compute_protocol_fee(composition_fee_y)?;

    lb_pair.accumulate_protocol_fees(protocol_fee_x, protocol_fee_y)?;

    Ok((protocol_fee_x, protocol_fee_y))
}

/// Charge swap fee and deposit to bin. Return liquidity share to mint after charge swap fee.
pub fn charge_fee_and_deposit<'a, 'info>(
    lb_pair: &'a mut RefMut<'_, LbPair>,
    bin_array_manager: &'a mut BinArrayManager,
    in_id: i32,
    bin_price: u128,
    amount_x: u64,
    amount_y: u64,
    composition_fee_x: u64,
    composition_fee_y: u64,
) -> Result<CompositeDepositInfo> {
    let (protocol_fee_x, protocol_fee_y) =
        charge_protocol_fee(lb_pair, composition_fee_x, composition_fee_y)?;

    let bin = bin_array_manager.get_bin_mut(in_id)?;

    // pay swap fee firstly
    bin.deposit_composition_fee(
        composition_fee_x.safe_sub(protocol_fee_x)?,
        composition_fee_y.safe_sub(protocol_fee_y)?,
    )?;

    // Amount the user is depositing after internal swap.
    let amount_x_into_bin_after_fee = amount_x.safe_sub(composition_fee_x)?;
    let amount_y_into_bin_after_fee = amount_y.safe_sub(composition_fee_y)?;

    // Calculate liquidity after charge swap fee
    let in_liquidity = get_liquidity(
        amount_x_into_bin_after_fee,
        amount_y_into_bin_after_fee,
        bin_price,
    )?;
    // calculate bin_liquidity after deposit composition fee
    let bin_liquidity = get_liquidity(bin.amount_x, bin.amount_y, bin_price)?;

    // Calculate liquidity share to mint after charge swap fee
    let liquidity_share = get_liquidity_share(in_liquidity, bin_liquidity, bin.liquidity_supply)?;

    // Protocol fee is not accumulated in the bin liquidity.
    bin.deposit(
        amount_x_into_bin_after_fee,
        amount_y_into_bin_after_fee,
        liquidity_share,
    )?;

    Ok(CompositeDepositInfo {
        liquidity_share,
        protocol_token_x_fee_amount: protocol_fee_x,
        protocol_token_y_fee_amount: protocol_fee_y,
    })
}

/// Deposit to bin without charging internal swap fee
fn deposit<'info>(
    bin_array_manager: &mut BinArrayManager,
    in_id: i32,
    amount_x: u64,
    amount_y: u64,
    liquidity_share: u128,
) -> Result<()> {
    let bin = bin_array_manager.get_bin_mut(in_id)?;
    bin.deposit(amount_x, amount_y, liquidity_share)
}

pub fn get_amount_into_bin(in_amount: u64, distribution: u64) -> Result<u64> {
    require!(distribution <= BASIS_POINT_MAX as u64, LBError::InvalidBps);

    let amount: u64 = u128::from(in_amount)
        .safe_mul(distribution.into())
        .and_then(|v| v.safe_div(BASIS_POINT_MAX as u128))?
        .try_into()
        .map_err(|_| LBError::TypeCastFailed)?;

    Ok(amount)
}

/// Get bin, and deposit liquidity
pub fn get_deposit_bin_info(
    in_id: i32,
    bin_step: u16,
    amount_x_into_bin: u64,
    amount_y_into_bin: u64,
    bin_array_manager: &mut BinArrayManager,
) -> Result<DepositBinInfo> {
    let LiquidityShareInfo {
        liquidity_share,
        bin_liquidity,
    } = get_liquidity_share_by_in_amount(
        in_id,
        bin_step,
        amount_x_into_bin,
        amount_y_into_bin,
        bin_array_manager,
    )?;

    let bin = bin_array_manager.get_bin_mut(in_id)?;
    let price = bin.get_or_store_bin_price(in_id, bin_step)?;

    if bin.liquidity_supply == 0 {
        return Ok(DepositBinInfo {
            amount_x_into_bin,
            amount_y_into_bin,
            liquidity_share,
            bin_price: price,
            out_amount_x: amount_x_into_bin,
            out_amount_y: amount_y_into_bin,
            bin_liquidity,
        });
    }

    let (out_amount_x, out_amount_y) =
        get_out_amount_after_deposit(liquidity_share, amount_x_into_bin, amount_y_into_bin, &bin)?;

    Ok(DepositBinInfo {
        amount_x_into_bin,
        amount_y_into_bin,
        liquidity_share,
        bin_price: price,
        out_amount_x,
        out_amount_y,
        bin_liquidity,
    })
}

/// Calculate composition fee for LP and protocol. The protocol share is inclusive of the total composition fee.
pub fn compute_composition_fee<'info>(
    out_amount_x: u64,
    amount_x_into_bin: u64,
    out_amount_y: u64,
    amount_y_into_bin: u64,
    lb_pair: &LbPair,
) -> Result<u64> {
    // Eg: X out > X_in is similar to Swap Y -> X, charge Y for fee (Y == opposite delta)
    if out_amount_x > amount_x_into_bin {
        let delta = amount_y_into_bin.safe_sub(out_amount_y)?;
        lb_pair.compute_composition_fee(delta)
    } else {
        Ok(0)
    }
}

/// Verify that the amounts are correct and that the composition factor is not flawed.
/// Which means, bin before active bin can only contains token Y, bin after active bin can only contain token X.
fn verify_in_amounts(amount_x: u64, amount_y: u64, active_id: i32, id: i32) -> Result<()> {
    if id < active_id {
        require!(amount_x == 0, LBError::CompositionFactorFlawed);
    }

    if id > active_id {
        require!(amount_y == 0, LBError::CompositionFactorFlawed);
    }

    // id == active_id allows X and Y to be deposited in
    Ok(())
}

// deposit in a bin
pub fn deposit_in_bin_id(
    in_id: i32,
    amount_x_into_bin: u64,
    amount_y_into_bin: u64,
    lb_pair: &mut RefMut<'_, LbPair>,
    position: &mut DynamicPosition,
    bin_array_manager: &mut BinArrayManager,
    sender: Pubkey,
) -> Result<Option<CompositionFee>> {
    let active_id = lb_pair.active_id;
    let bin_step = lb_pair.bin_step;
    let mut composition_fee_event = None;
    // Make sure composition factor not flawed
    verify_in_amounts(amount_x_into_bin, amount_y_into_bin, active_id, in_id)?;
    let liquidity_share = if in_id == lb_pair.active_id {
        // Update volatility parameters to reflect the latest volatile fee for composite swap
        let current_timestamp = Clock::get()?.unix_timestamp;
        lb_pair.update_volatility_parameters(current_timestamp)?;

        let DepositBinInfo {
            amount_x_into_bin,
            amount_y_into_bin,
            liquidity_share,
            bin_price,
            out_amount_x,
            out_amount_y,
            ..
        } = get_deposit_bin_info(
            in_id,
            bin_step,
            amount_x_into_bin,
            amount_y_into_bin,
            bin_array_manager,
        )?;

        // assert for max_swapped_amount if it is internal swap
        if out_amount_x > amount_x_into_bin {
            let (throttled_status, max_swapped_amount) =
                lb_pair.get_swap_cap_status_and_amount(current_timestamp as u64, false)?;

            if throttled_status {
                let delta = out_amount_x.safe_sub(amount_x_into_bin)?;
                require!(delta <= max_swapped_amount, LBError::ExceedMaxSwappedAmount);
            }
        }

        let composition_fee_x = compute_composition_fee(
            out_amount_y,
            amount_y_into_bin,
            out_amount_x,
            amount_x_into_bin,
            lb_pair,
        )?;

        let composition_fee_y = compute_composition_fee(
            out_amount_x,
            amount_x_into_bin,
            out_amount_y,
            amount_y_into_bin,
            &lb_pair,
        )?;
        if composition_fee_x.safe_add(composition_fee_y)? > 0 {
            let CompositeDepositInfo {
                liquidity_share,
                protocol_token_x_fee_amount,
                protocol_token_y_fee_amount,
            } = charge_fee_and_deposit(
                lb_pair,
                bin_array_manager,
                in_id,
                bin_price,
                amount_x_into_bin,
                amount_y_into_bin,
                composition_fee_x,
                composition_fee_y,
            )?;

            composition_fee_event = Some(CompositionFee {
                bin_id: in_id as i16,
                from: sender,
                protocol_token_x_fee_amount,
                protocol_token_y_fee_amount,
                token_x_fee_amount: composition_fee_x,
                token_y_fee_amount: composition_fee_y,
            });

            liquidity_share
        } else {
            deposit(
                bin_array_manager,
                in_id,
                amount_x_into_bin,
                amount_y_into_bin,
                liquidity_share,
            )?;
            // No fee
            liquidity_share
        }
    } else {
        let LiquidityShareInfo {
            liquidity_share, ..
        } = get_liquidity_share_by_in_amount(
            in_id,
            bin_step,
            amount_x_into_bin,
            amount_y_into_bin,
            bin_array_manager,
        )?;

        deposit(
            bin_array_manager,
            in_id,
            amount_x_into_bin,
            amount_y_into_bin,
            liquidity_share,
        )?;
        liquidity_share
    };

    require!(liquidity_share > 0, LBError::ZeroLiquidity);

    position.deposit(in_id, liquidity_share)?;
    Ok(composition_fee_event)
}

pub struct LiquidityShareInfo {
    /// bin_liquidity
    pub bin_liquidity: u128,
    /// liquidity_share
    pub liquidity_share: u128,
}

/// Get bin, and deposit liquidity
pub fn get_liquidity_share_by_in_amount(
    in_id: i32,
    bin_step: u16,
    in_amount_x: u64,
    in_amount_y: u64,
    bin_array_manager: &mut BinArrayManager,
) -> Result<LiquidityShareInfo> {
    let bin = bin_array_manager.get_bin_mut(in_id)?;
    let price = bin.get_or_store_bin_price(in_id, bin_step)?;

    let in_liquidity: u128 = get_liquidity(in_amount_x, in_amount_y, price)?;
    let bin_liquidity = get_liquidity(bin.amount_x, bin.amount_y, price)?;
    if bin.liquidity_supply == 0 {
        return Ok(LiquidityShareInfo {
            bin_liquidity,
            liquidity_share: in_liquidity,
        });
    }

    let liquidity_share = get_liquidity_share(in_liquidity, bin_liquidity, bin.liquidity_supply)?;

    return Ok(LiquidityShareInfo {
        bin_liquidity,
        liquidity_share,
    });
}
