use super::add_liquidity_by_weight::BinLiquidityDistributionByWeight;
use crate::authorize_modify_position;
use crate::deposit_in_bin_id;
use crate::errors::LBError;
use crate::events::AddLiquidity as AddLiquidityEvent;
use crate::manager::bin_array_manager::BinArrayManager;
use crate::math::safe_math::SafeMath;
use crate::math::weight_to_amounts::to_amount_ask_side;
use crate::math::weight_to_amounts::to_amount_bid_side;
use crate::math::weight_to_amounts::AmountInBinSingleSide;
use crate::state::action_access::get_lb_pair_type_access_validator;
use crate::state::bin_array_bitmap_extension::BinArrayBitmapExtension;
use crate::state::dynamic_position::{DynamicPositionLoader, PositionV3};
use crate::state::lb_pair::LbPair;
use crate::BinArrayAccount;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::TransferChecked;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use std::collections::{BTreeMap, BTreeSet};

#[derive(AnchorSerialize, AnchorDeserialize, Eq, PartialEq, Clone, Debug)]
pub struct LiquidityOneSideParameter {
    /// Amount of X token or Y token to deposit
    pub amount: u64,
    /// Active bin that integrator observe off-chain
    pub active_id: i32,
    /// max active bin slippage allowed
    pub max_active_bin_slippage: i32,
    /// Liquidity distribution to each bins
    pub bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
}

impl LiquidityOneSideParameter {
    fn bin_count(&self) -> u32 {
        self.bin_liquidity_dist.len() as u32
    }

    fn validate<'a, 'info>(&'a self, active_id: i32) -> Result<()> {
        require!(self.amount != 0, LBError::InvalidInput);

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
        Ok(())
    }

    // require bin id to be sorted before doing this
    fn to_amounts_into_bin<'a, 'info>(
        &'a self,
        active_id: i32,
        bin_step: u16,
        deposit_for_y: bool,
    ) -> Result<Vec<AmountInBinSingleSide>> {
        if deposit_for_y {
            to_amount_bid_side(
                active_id,
                self.amount,
                &self
                    .bin_liquidity_dist
                    .iter()
                    .map(|x| (x.bin_id, x.weight))
                    .collect::<Vec<(i32, u16)>>(),
            )
        } else {
            to_amount_ask_side(
                active_id,
                self.amount,
                bin_step,
                &self
                    .bin_liquidity_dist
                    .iter()
                    .map(|x| (x.bin_id, x.weight))
                    .collect::<Vec<(i32, u16)>>(),
            )
        }
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct ModifyLiquidityOneSide<'info> {
    #[account(
        mut,
        has_one = lb_pair,
        constraint = authorize_modify_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, PositionV3>,

    #[account(mut)]
    pub lb_pair: AccountLoader<'info, LbPair>,

    #[account(
        mut,
        has_one = lb_pair,
    )]
    pub bin_array_bitmap_extension: Option<AccountLoader<'info, BinArrayBitmapExtension>>,

    #[account(mut)]
    pub user_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub reserve: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    pub sender: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ModifyLiquidityOneSide<'info> {
    pub fn is_deposit_y(&self, lb_pair: &LbPair) -> bool {
        self.user_token.mint == lb_pair.token_y_mint
    }
    // true mean deposit in token y, false mean deposit in token x
    fn validate(&self, lb_pair: &LbPair, deposit_for_y: bool) -> Result<()> {
        if deposit_for_y {
            require!(
                self.token_mint.key() == lb_pair.token_y_mint,
                LBError::InvalidAccountForSingleDeposit
            );
            require!(
                self.user_token.mint == lb_pair.token_y_mint,
                LBError::InvalidAccountForSingleDeposit
            );
            require!(
                self.reserve.key() == lb_pair.reserve_y,
                LBError::InvalidAccountForSingleDeposit
            );
        } else {
            require!(
                self.token_mint.key() == lb_pair.token_x_mint,
                LBError::InvalidAccountForSingleDeposit
            );
            require!(
                self.user_token.mint == lb_pair.token_x_mint,
                LBError::InvalidAccountForSingleDeposit
            );
            require!(
                self.reserve.key() == lb_pair.reserve_x,
                LBError::InvalidAccountForSingleDeposit
            );
        }
        Ok(())
    }

    fn transfer_to_reserve(&self, amount: u64) -> Result<()> {
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.user_token.to_account_info(),
                    to: self.reserve.to_account_info(),
                    authority: self.sender.to_account_info(),
                    mint: self.token_mint.to_account_info(),
                },
            ),
            amount,
            self.token_mint.decimals,
        )
    }
}
pub fn handle<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    liquidity_parameter: &LiquidityOneSideParameter,
) -> Result<()> {
    let (amounts_in_bin, deposit_for_y) = {
        let lb_pair = ctx.accounts.lb_pair.load()?;
        let active_id = lb_pair.active_id;
        let bin_step = lb_pair.bin_step;
        liquidity_parameter.validate(active_id)?;
        let deposit_for_y = ctx.accounts.is_deposit_y(&lb_pair);
        (
            liquidity_parameter.to_amounts_into_bin(active_id, bin_step, deposit_for_y)?,
            deposit_for_y,
        )
    };

    handle_deposit_by_amounts_one_side(&ctx, &amounts_in_bin, deposit_for_y)
}

pub fn handle_deposit_by_amounts_one_side<'a, 'b, 'c, 'info>(
    ctx: &Context<'a, 'b, 'c, 'info, ModifyLiquidityOneSide<'info>>,
    amounts_in_bin: &Vec<AmountInBinSingleSide>, // vec of bin id and amount
    deposit_for_y: bool,
) -> Result<()> {
    let lb_pair_pk = ctx.accounts.lb_pair.key();
    let mut lb_pair = ctx.accounts.lb_pair.load_mut()?;
    {
        let pair_type_access_validator =
            get_lb_pair_type_access_validator(&lb_pair, Clock::get()?.slot)?;
        require!(
            pair_type_access_validator.validate_add_liquidity_access(ctx.accounts.sender.key()),
            LBError::PoolDisabled
        );
    }

    // let min_bin_id = amounts_in_bin[0].bin_id;
    // let max_bin_id = amounts_in_bin[amounts_in_bin.len() - 1].bin_id;

    let active_id = lb_pair.active_id;

    ctx.accounts.validate(&lb_pair, deposit_for_y)?;

    let mut position = ctx.accounts.position.load_content_mut()?;

    // amounts_in_bin must be sorted in ascending order
    let mut remaining_accounts = &ctx.remaining_accounts[..];
    let mut total_amount_x = 0;
    let mut total_amount_y = 0;

    let mut amounts_in_bin_iter = amounts_in_bin.iter();
    let mut amount_in_bin = amounts_in_bin_iter.next();

    loop {
        if amount_in_bin.is_none() {
            break;
        }
        let bin_array_account = BinArrayAccount::try_accounts(
            &crate::ID,
            &mut remaining_accounts,
            &[],
            &mut BTreeMap::new(),
            &mut BTreeSet::new(),
        )?;

        let mut bin_arrays = [bin_array_account.load_and_validate(lb_pair_pk)?];

        let mut bin_array_manager = BinArrayManager::new(&mut bin_arrays)?;
        bin_array_manager.validate_bin_arrays(amount_in_bin.unwrap().bin_id)?;

        let before_liquidity_flags = bin_array_manager.get_zero_liquidity_flags();

        bin_array_manager.migrate_to_v2()?;

        // Update reward per liquidity store for active bin
        bin_array_manager.update_rewards(&mut lb_pair)?;

        let (lower_bin_id, upper_bin_id) = bin_array_manager.get_lower_upper_bin_id()?;
        loop {
            if amount_in_bin.is_none() {
                break;
            }
            let &AmountInBinSingleSide { amount, bin_id } = amount_in_bin.unwrap();

            if lower_bin_id <= bin_id && bin_id <= upper_bin_id {
                position.update_earning_per_token_stored(&bin_array_manager, bin_id, bin_id)?;
                if amount != 0 {
                    let (amount_x_into_bin, amount_y_into_bin) = if deposit_for_y {
                        total_amount_y = total_amount_y.safe_add(amount)?;
                        (0, amount)
                    } else {
                        total_amount_x = total_amount_x.safe_add(amount)?;
                        (amount, 0)
                    };

                    if let Some(event) = deposit_in_bin_id(
                        bin_id,
                        amount_x_into_bin,
                        amount_y_into_bin,
                        &mut lb_pair,
                        &mut position,
                        &mut bin_array_manager,
                        ctx.accounts.sender.key(),
                    )? {
                        emit_cpi!(event);
                    };
                }
                amount_in_bin = amounts_in_bin_iter.next();
            } else {
                break;
            }
        }

        lb_pair.flip_bin_arrays(
            &before_liquidity_flags,
            &bin_array_manager,
            &ctx.accounts.bin_array_bitmap_extension,
        )?;
    }

    if deposit_for_y {
        require!(total_amount_y > 0, LBError::InvalidInput);
        ctx.accounts.transfer_to_reserve(total_amount_y)?;
    } else {
        require!(total_amount_x > 0, LBError::InvalidInput);
        ctx.accounts.transfer_to_reserve(total_amount_x)?;
    }

    position.set_last_updated_at(Clock::get()?.unix_timestamp);

    emit_cpi!(AddLiquidityEvent {
        position: ctx.accounts.position.key(),
        lb_pair: ctx.accounts.lb_pair.key(),
        from: ctx.accounts.sender.key(),
        amounts: [total_amount_x, total_amount_y],
        active_bin_id: active_id,
    });
    Ok(())
}

#[cfg(test)]
mod add_liquidity_one_side_test {
    use super::*;

    fn new_liquidity_parameter_from_dist(
        amount: u64,
        bin_liquidity_dist: Vec<BinLiquidityDistributionByWeight>,
    ) -> LiquidityOneSideParameter {
        LiquidityOneSideParameter {
            amount,
            active_id: 0,
            max_active_bin_slippage: i32::MAX,
            bin_liquidity_dist,
        }
    }

    #[test]
    fn test_simple_case_one_side() {
        let amount_x = 100000;
        let amount_y = 2000000;

        let bin_step = 10;
        let bin_liquidity_dist = vec![
            BinLiquidityDistributionByWeight {
                bin_id: 1,
                weight: 20,
            },
            BinLiquidityDistributionByWeight {
                bin_id: 3,
                weight: 10,
            },
            BinLiquidityDistributionByWeight {
                bin_id: 5,
                weight: 10,
            },
            BinLiquidityDistributionByWeight {
                bin_id: 7,
                weight: 10,
            },
        ];

        // bid side
        let liquidity_parameter =
            new_liquidity_parameter_from_dist(amount_y, bin_liquidity_dist.clone());

        let active_id = 6;
        let in_amounts = liquidity_parameter
            .to_amounts_into_bin(active_id, bin_step, true)
            .unwrap();
        println!("ask side {:?}", in_amounts);

        // ask side
        let liquidity_parameter = new_liquidity_parameter_from_dist(amount_x, bin_liquidity_dist);
        let active_id = 4;
        let in_amounts = liquidity_parameter
            .to_amounts_into_bin(active_id, bin_step, false)
            .unwrap();
        println!("bid side {:?}", in_amounts);
    }
}
