use crate::instructions::{set_pair_status_permissionless::SetPairStatusPermissionlessParams, *};
use anchor_client::Cluster;
use clap::*;

#[derive(Parser, Debug)]
pub struct ConfigOverride {
    /// Cluster override
    ///
    /// Values = mainnet, testnet, devnet, localnet.
    /// Default: mainnet
    #[clap(global = true, long = "provider.cluster", default_value_t = Cluster::Mainnet)]
    pub cluster: Cluster,
    /// Wallet override
    ///
    /// Example: /path/to/wallet/keypair.json
    /// Default: ~/.config/solana/id.json
    #[clap(
        global = true,
        long = "provider.wallet",
        default_value_t = String::from(shellexpand::tilde("~/.config/solana/id.json"))
    )]
    pub wallet: String,
    /// Priority fee
    #[clap(global = true, long = "priority-fee", default_value_t = 0)]
    pub priority_fee: u64,
}

pub fn parse_bin_liquidity_removal(src: &str) -> Result<(i32, f64), Error> {
    let mut parsed_str: Vec<&str> = src.split(',').collect();

    let bps_to_remove = parsed_str
        .pop()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| clap::error::Error::new(error::ErrorKind::InvalidValue))?;

    let bin_id = parsed_str
        .pop()
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| clap::error::Error::new(error::ErrorKind::InvalidValue))?;

    Ok((bin_id, bps_to_remove))
}

pub fn parse_bin_liquidity_distribution(src: &str) -> Result<(i32, f64, f64), Error> {
    let mut parsed_str: Vec<&str> = src.split(',').collect();

    let dist_y = parsed_str
        .pop()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| clap::error::Error::new(error::ErrorKind::InvalidValue))?;

    let dist_x = parsed_str
        .pop()
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| clap::error::Error::new(error::ErrorKind::InvalidValue))?;

    let delta_id = parsed_str
        .pop()
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| clap::error::Error::new(error::ErrorKind::InvalidValue))?;

    Ok((delta_id, dist_x, dist_y))
}

#[derive(Debug, Clone, ValueEnum)]
pub enum SelectiveRounding {
    Up,
    Down,
    None,
}

#[derive(Parser, Debug)]
pub enum DLMMCommand {
    /// Create a new liquidity pair.
    InitializePair2(InitLbPair2Params),
    /// Create a new liquidity pair.
    InitializePair(InitLbPairParams),
    /// Initialize bin array for the given liquidity pair. Use InitializeBinArrayWithPriceRange or InitializeBinArrayWithBinRange for a more user friendly version.
    InitializeBinArray(InitBinArrayParams),
    /// Initialize bin array for the given liquidity pair based on price range. For example: Initialize bin arrays for BTC/USDC from 20000 -> 30000 price.
    InitializeBinArrayWithPriceRange(InitBinArrayWithPriceRangeParams),
    /// Initialize bin array for the given liquidity pair based on bin range. For example: Initialize bin arrays for BTC/USDC from bin 5660 -> 6600.
    InitializeBinArrayWithBinRange(InitBinArrayWithBinRangeParams),
    /// Initialize position for the given liquidity pair based on price range.
    InitializePositionWithPriceRange(InitPositionWithPriceRangeParams),
    /// Initialize position for the given liquidity pair based on bin range.
    InitializePosition(InitPositionParams),
    /// Deposit liquidity to the position of the given liquidity pair.
    AddLiquidity(AddLiquidityParams),
    /// Remove liquidity from the position of the given liquidity pair.
    RemoveLiquidity(RemoveLiquidityParams),
    /// Trade token X -> Y, or vice versa.
    SwapExactIn(SwapExactInParams),
    SwapExactOut(SwapExactOutParams),
    SwapWithPriceImpact(SwapWithPriceImpactParams),
    /// Show information of the given liquidity pair.
    ShowPair(ShowPairParams),
    /// Show information of the given position.
    ShowPosition(ShowPositionParams),
    ClaimReward(ClaimRewardParams),
    UpdateRewardDuration(UpdateRewardDurationParams),
    UpdateRewardFunder(UpdateRewardFunderParams),
    /// Close liquidity position.
    ClosePosition(ClosePositionParams),
    /// Claim fee
    ClaimFee(ClaimFeeParams),
    /// Increase an oracle observation sample length
    IncreaseOracleLength(IncreaseOracleLengthParams),
    ShowPresetParameter(ShowPresetAccountParams),
    ListAllBinStep,
    InitializeCustomizablePermissionlessLbPair(InitCustomizablePermissionlessLbPairParam),
    InitializeCustomizablePermissionlessLbPair2(InitCustomizablePermissionlessLbPair2Param),
    /// Seed liquidity by operator
    SeedLiquidityByOperator(SeedLiquidityByOperatorParameters),
    SeedLiquiditySingleBinByOperator(SeedLiquiditySingleBinByOperatorParameters),
    SetPairStatusPermissionless(SetPairStatusPermissionlessParams),
    GetAllPositionsForAnOwner(GetAllPositionsParams),
    #[clap(flatten)]
    Admin(AdminCommand),
}

#[derive(Parser, Debug)]
#[clap(version, about, author)]
pub struct Cli {
    #[clap(flatten)]
    pub config_override: ConfigOverride,
    #[clap(subcommand)]
    pub command: DLMMCommand,
}

#[derive(Debug, Parser)]
pub enum AdminCommand {
    /// Create a new permission liquidity pair. It allow liquidity fragmentation with exact bin step.
    InitializePermissionPair(InitPermissionLbPairParameters),
    SetPairStatus(SetPairStatusParams),
    /// Remove liquidity by price range
    RemoveLiquidityByPriceRange(RemoveLiquidityByPriceRangeParameters),
    SetActivationPoint(SetActivationPointParam),
    WithdrawProtocolFee(WithdrawProtocolFeeParams),
    InitializeReward(InitializeRewardParams),
    FundReward(FundRewardParams),
    InitializePresetParameter(InitPresetParameters),
    ClosePresetParameter(ClosePresetAccountParams),
    SetPreActivationDuration(SetPreactivationDurationParam),
    SetPreActivationSwapAddress(SetPreactivationSwapAddressParam),
    InitializeTokenBadge(InitializeTokenBadgeParams),
    CreateClaimProtocolFeeOperator(CreateClaimFeeOperatorParams),
    CloseClaimProtocolFeeOperator(CloseClaimFeeOperatorParams),
    UpdateBaseFee(UpdateBaseFeeParams),
}
