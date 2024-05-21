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
}

fn parse_bin_liquidity_removal(src: &str) -> Result<(i32, f64), Error> {
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

fn parse_bin_liquidity_distribution(src: &str) -> Result<(i32, f64, f64), Error> {
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

#[derive(Parser, Debug)]
pub enum Command {
    /// Create a new liquidity pair.
    InitializePair {
        /// Preset parameter pubkey. Get the pubkey from list_all_binstep command.
        preset_parameter: Pubkey,
        /// Token X mint of the liquidity pair. Eg: BTC. This should be the base token.
        token_mint_x: Pubkey,
        /// Token Y mint of the liquidity pair. Eg: USDC. This should be the quote token.
        token_mint_y: Pubkey,
        /// The initial price of the liquidity pair. Eg: 24123.12312412 USDC per 1 BTC.
        initial_price: f64,
    },
    /// Initialize bin array for the given liquidity pair. Use InitializeBinArrayWithPriceRange or InitializeBinArrayWithBinRange for a more user friendly version.
    InitializeBinArray {
        /// Index of the bin array.
        #[clap(long, allow_negative_numbers = true)]
        bin_array_index: i64,
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
    },
    /// Initialize bin array for the given liquidity pair based on price range. For example: Initialize bin arrays for BTC/USDC from 20000 -> 30000 price.
    InitializeBinArrayWithPriceRange {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Lower bound of the price.
        lower_price: f64,
        /// Upper bound of the price.
        upper_price: f64,
    },
    /// Initialize bin array for the given liquidity pair based on bin range. For example: Initialize bin arrays for BTC/USDC from bin 5660 -> 6600.
    InitializeBinArrayWithBinRange {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Lower bound of the bin range.
        #[clap(long, allow_negative_numbers = true)]
        lower_bin_id: i32,
        /// Upper bound of the bin range.
        #[clap(long, allow_negative_numbers = true)]
        upper_bin_id: i32,
    },
    /// Initialize position for the given liquidity pair based on price range.
    InitializePositionWithPriceRange {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Lower bound of the price.
        lower_price: f64,
        /// Width of the position. Start with 1 until 70.
        width: i32,
        /// NFT mint for alpha access
        nft_mint: Option<Pubkey>,
    },
    /// Initialize position for the given liquidity pair based on bin range.
    InitializePosition {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Lower bound of the bin range.
        #[clap(long, allow_negative_numbers = true)]
        lower_bin_id: i32,
        /// Width of the position. Start with 1 until 70.
        width: i32,
        /// NFT mint for alpha access
        nft_mint: Option<Pubkey>,
    },
    /// Deposit liquidity to the position of the given liquidity pair.
    AddLiquidity {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Position for the deposit.
        position: Pubkey,
        /// Amount of token X to be deposited.
        amount_x: u64,
        /// Amount of token Y to be deposited.
        amount_y: u64,
        /// Liquidity distribution to the bins. "<DELTA_ID,DIST_X,DIST_Y, DELTA_ID,DIST_X,DIST_Y, ...>" where
        /// DELTA_ID = Number of bins surrounding the active bin. This decide which bin the token is going to deposit to. For example: if the current active id is 5555, delta_ids is 1, the user will be depositing to bin 5554, 5555, and 5556.
        /// DIST_X = Percentage of amount_x to be deposited to the bins. Must not > 1.0
        /// DIST_Y = Percentage of amount_y to be deposited to the bins. Must not > 1.0
        /// For example: --bin-liquidity-distribution "-1,0.0,0.25 0,0.75,0.75 1,0.25,0.0"
        #[clap(long, value_parser = parse_bin_liquidity_distribution, value_delimiter = ' ', allow_hyphen_values = true)]
        bin_liquidity_distribution: Vec<(i32, f64, f64)>,
    },
    /// Remove liquidity from the position of the given liquidity pair.
    RemoveLiquidity {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Bin liquidity information to be remove. "<BIN_ID,BPS_TO_REMOVE, BIN_ID,BPS_TO_REMOVE, ...>" where
        /// BIN_ID = bin id to withdraw
        /// BPS_TO_REMOVE = Percentage of position owned share to be removed. Maximum is 1.0f, which equivalent to 100%.
        #[clap(long, value_parser = parse_bin_liquidity_removal, value_delimiter = ' ', allow_hyphen_values = true)]
        bin_liquidity_removal: Vec<(i32, f64)>,
        /// Position to be withdraw.
        position: Pubkey,
    },
    /// Trade token X -> Y, or vice versa.
    Swap {
        /// Address of the liquidity pair.
        lb_pair: Pubkey,
        /// Amount of token to be sell.
        amount_in: u64,
        /// Buy direction. true = buy token Y, false = buy token X.
        #[clap(long)]
        swap_for_y: bool,
    },
    /// Show information of the given liquidity pair.
    ShowPair {
        lb_pair: Pubkey,
    },
    /// Show information of the given position.
    ShowPosition {
        position: Pubkey,
    },

    ClaimReward {
        lb_pair: Pubkey,
        reward_index: u64,
        position: Pubkey,
    },
    UpdateRewardDuration {
        lb_pair: Pubkey,
        reward_index: u64,
        reward_duration: u64,
    },
    UpdateRewardFunder {
        lb_pair: Pubkey,
        reward_index: u64,
        funder: Pubkey,
    },
    /// Close liquidity position.
    ClosePosition {
        /// Address of the position.
        position: Pubkey,
    },
    /// Claim fee
    ClaimFee {
        /// Address of the position.
        position: Pubkey,
    },
    /// Increase an oracle observation sample length
    IncreaseLength {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Length to add
        length_to_add: u64,
    },

    ShowPresetParameter {
        /// Preset parameter pubkey. Get from ListAllBinStep
        preset_parameter: Pubkey,
    },

    ListAllBinStep,

    SimulateSwapDemand {
        lb_pair: Pubkey,
        x_amount: f64, // ex: 10 jup
        y_amount: f64, // ex: 1k usdc
        side_ratio: u64,
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
    pub command: Command,
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
        /// Lock duration for bootstrap liquidity position
        lock_duration_in_slot: u64,
    },

    /// Toggle pool status
    TogglePoolStatus {
        /// Address of the pair
        lb_pair: Pubkey,
    },

    /// Seed liquidity
    SeedLiquidity {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Base position path
        base_position_path: String,
        /// amount of x
        amount: u64,
        /// min price
        min_price: f64,
        /// max price
        max_price: f64,
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

    CheckMyBalance {
        /// Address of the pair
        lb_pair: Pubkey,
        // base position path
        base_position_key: Pubkey,
        /// min price
        min_price: f64,
        /// max price
        max_price: f64,
    },

    SetActivationSlot {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Activation slot
        activation_slot: u64,
    },

    SetSwapCapAmount {
        lb_pair: Pubkey,
        swap_cap_amount: u64,
        swap_cap_deactivate_slot: u64,
    },

    WithdrawProtocolFee {
        lb_pair: Pubkey,
        amount_x: u64,
        amount_y: u64,
    },
    UpdateFeeOwner {
        lb_pair: Pubkey,
        fee_owner: Pubkey,
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
    /// Remove whitelisted wallet from a permission pool
    UpdateWhitelistedWallet {
        /// Address of the pair
        lb_pair: Pubkey,
        /// Address of the wallet
        wallet_address: Pubkey,
        /// Index of the wallet to be updated
        idx: u8,
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
    },
    ClosePresetParameter {
        /// Preset parameter pubkey. Get from ListAllBinStep
        preset_parameter: Pubkey,
    },
}
