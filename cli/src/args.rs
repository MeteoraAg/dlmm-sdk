use crate::instructions::*;
use anchor_client::solana_sdk::pubkey::Pubkey;
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
    ShowPosition {
        position: Pubkey,
    },

    ClaimReward(ClaimRewardParams),
    UpdateRewardDuration(UpdateRewardDurationParams),
    UpdateRewardFunder(UpdateRewardFunderParams),
    /// Close liquidity position.
    ClosePosition(ClosePositionParams),
    /// Claim fee
    ClaimFee(ClaimFeeParams),
    /// Increase an oracle observation sample length
    IncreaseLength(IncreaseLengthParams),

    ShowPresetParameter {
        /// Preset parameter pubkey. Get from ListAllBinStep
        preset_parameter: Pubkey,
    },

    ListAllBinStep,

    InitializeCustomizablePermissionlessLbPair(InitCustomizablePermissionlessLbPairParam),

    /// Seed liquidity
    SeedLiquidity {
        /// Address of the pair
        #[clap(long)]
        lb_pair: Pubkey,
        /// Base position path
        #[clap(long)]
        base_position_path: String,
        /// Amount of x
        #[clap(long)]
        amount: u64,
        /// Min price
        #[clap(long)]
        min_price: f64,
        /// Max price
        #[clap(long)]
        max_price: f64,
        /// Base pubkey
        #[clap(long)]
        base_pubkey: Pubkey,
        /// Curvature
        #[clap(long)]
        curvature: f64,
        /// Position owner path
        #[clap(long)]
        position_owner_path: String,
        /// Max retries
        #[clap(long)]
        max_retries: u16,
    },

    /// Seed liquidity by operator
    SeedLiquidityByOperator {
        /// Address of the pair
        #[clap(long)]
        lb_pair: Pubkey,
        /// Base position path
        #[clap(long)]
        base_position_path: String,
        /// Amount of x
        #[clap(long)]
        amount: u64,
        /// Min price
        #[clap(long)]
        min_price: f64,
        /// Max price
        #[clap(long)]
        max_price: f64,
        /// Base pubkey
        #[clap(long)]
        base_pubkey: Pubkey,
        /// Curvature
        #[clap(long)]
        curvature: f64,
        /// position owner
        #[clap(long)]
        position_owner: Pubkey,
        /// fee owner
        #[clap(long)]
        fee_owner: Pubkey,
        /// lock release point
        #[clap(long)]
        lock_release_point: u64,
        /// Max retries
        #[clap(long)]
        max_retries: u16,
    },

    SeedLiquiditySingleBin {
        /// Address of the pair
        #[clap(long)]
        lb_pair: Pubkey,
        /// Base position path
        #[clap(long)]
        base_position_path: String,
        /// Base position pubkey
        #[clap(long)]
        base_pubkey: Pubkey,
        /// amount of x
        #[clap(long)]
        amount: u64,
        #[clap(long)]
        price: f64,
        /// Position owner
        #[clap(long)]
        position_owner_path: String,
        /// Selective rounding
        #[clap(long)]
        selective_rounding: SelectiveRounding,
    },

    SeedLiquiditySingleBinByOperator {
        /// Address of the pair
        #[clap(long)]
        lb_pair: Pubkey,
        /// Base position path
        #[clap(long)]
        base_position_path: String,
        /// Base position pubkey
        #[clap(long)]
        base_pubkey: Pubkey,
        /// amount of x
        #[clap(long)]
        amount: u64,
        /// price
        #[clap(long)]
        price: f64,
        /// Position owner
        #[clap(long)]
        position_owner: Pubkey,
        /// lock release point
        #[clap(long)]
        lock_release_point: u64,
        /// fee owner
        #[clap(long)]
        fee_owner: Pubkey,
        /// Selective rounding
        #[clap(long)]
        selective_rounding: SelectiveRounding,
    },

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
    InitializePermissionPair {
        /// Bin step of the liquidity pair. It decide the bps when between bins.
        bin_step: u16,
        /// Token X mint of the liquidity pair. Eg: BTC. This should be the base token.
        token_mint_x: Pubkey,
        /// Token Y mint of the liquidity pair. Eg: USDC. This should be the quote token.
        token_mint_y: Pubkey,
        /// The initial price of the liquidity pair. Eg: 24123.12312412 USDC per 1 BTC.
        initial_price: f64,
        /// Base keypair path
        base_keypair_path: String,
        /// Base fee bps
        base_fee_bps: u16,
        /// Activation type
        activation_type: u8,
    },

    /// Toggle pool status
    TogglePoolStatus {
        /// Address of the pair
        lb_pair: Pubkey,
    },

    /// Remove liquidity by price range
    RemoveLiquidityByPriceRange {
        /// Address of the pair
        lb_pair: Pubkey,
        // base position path
        base_position_key: Pubkey,
        /// min price
        min_price: f64,
        /// max price
        max_price: f64,
    },

    SetActivationPoint {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Activation point
        activation_point: u64,
    },

    WithdrawProtocolFee {
        lb_pair: Pubkey,
        amount_x: u64,
        amount_y: u64,
    },

    InitializeReward {
        lb_pair: Pubkey,
        reward_mint: Pubkey,
        reward_index: u64,
        reward_duration: u64,
        funder: Pubkey,
    },
    FundReward {
        lb_pair: Pubkey,
        reward_index: u64,
        funding_amount: u64,
    },

    InitializePresetParameter {
        /// Bin step. Represent the price increment / decrement.
        bin_step: u16,
        /// Used for base fee calculation. base_fee_rate = base_factor * bin_step
        base_factor: u16,
        /// Filter period determine high frequency trading time window.
        filter_period: u16,
        /// Decay period determine when the volatile fee start decay / decrease.
        decay_period: u16,
        /// Reduction factor controls the volatile fee rate decrement rate.
        reduction_factor: u16,
        /// Used to scale the variable fee component depending on the dynamic of the market
        variable_fee_control: u32,
        /// Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
        max_volatility_accumulator: u32,
        /// Min bin id supported by the pool based on the configured bin step.
        #[clap(long, allow_negative_numbers = true)]
        min_bin_id: i32,
        /// Max bin id supported by the pool based on the configured bin step.
        max_bin_id: i32,
        /// Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
        protocol_share: u16,
        /// Base fee power factor
        base_fee_power_factor: u8,
    },
    ClosePresetParameter {
        /// Preset parameter pubkey. Get from ListAllBinStep
        preset_parameter: Pubkey,
    },

    SetPreActivationDuration {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Preactivation duration
        pre_activation_duration: u16,
    },

    SetPreActivationSwapAddress {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Preactivation swap address
        pre_activation_swap_address: Pubkey,
    },
}
