use crate::*;
use anyhow::Result;
use clap::Parser;
use dlmm_interface::*;
use serde::Serialize;
use solana_client::{
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, RpcFilterType},
    rpc_request::TokenAccountsFilter,
};
use solana_account_decoder::UiAccountEncoding;
use solana_sdk::pubkey::Pubkey;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::str::FromStr;

const MAX_POOLS_FOR_COMPLEX_ALGORITHM: usize = 20;
const SELECTION_STRATEGY_LARGEST_FIRST: &str = "largest-first";
const SELECTION_STRATEGY_SMALLEST_FIRST: &str = "smallest-first";

const DEFAULT_BLACKLISTED_TOKENS: &[&str] = &["Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU"];

fn parse_token_thresholds(s: &str) -> anyhow::Result<HashMap<String, u64>> {
    let mut map = HashMap::new();
    for pair in s.split(',') {
        let pair = pair.trim();
        let parts: Vec<&str> = pair.split(':').collect();
        if parts.len() != 2 {
            return Err(anyhow::anyhow!("Invalid format '{}', expected token_mint:amount", pair));
        }
        
        let token_mint = parts[0].trim();
        let amount_str = parts[1].trim();
        
        let _ = Pubkey::from_str(token_mint)
            .map_err(|e| anyhow::anyhow!("Invalid token mint '{}': {}", token_mint, e))?;
            
        let amount = amount_str.parse::<u64>()
            .map_err(|e| anyhow::anyhow!("Invalid amount '{}': {}", amount_str, e))?;
            
        map.insert(token_mint.to_string(), amount);
    }

    Ok(map)
}

#[derive(Debug, Parser)]
pub struct QueryProtocolFeesByTokensParams {
    /// Comma-separated list of token mint addresses to filter by
    #[clap(short, long, value_delimiter = ',')]
    pub token_mints: Vec<String>,

    /// Output format (json, csv, table)
    #[clap(short, long, default_value = "table")]
    pub output_format: OutputFormat,

    /// Per-token minimum fee thresholds (format: token_mint:amount,token_mint:amount)
    #[clap(long, value_parser = parse_token_thresholds)]
    pub min_fee_threshold: Option<HashMap<String, u64>>,

    /// Only show pools with non-zero protocol fees
    #[clap(long)]
    pub non_zero_only: bool,

    /// Output CSV file path (optional, if not specified prints to console)
    #[clap(long)]
    pub csv_output_file: Option<String>,

    /// Target amounts per token mint (format: token_mint:amount,token_mint:amount)
    #[clap(long)]
    pub target_amounts: Option<String>,

    /// Allow going under target by this percentage (default: 0, meaning only accept over-target)
    #[clap(long, default_value = "0")]
    pub under_target_tolerance: f64,

    /// Output pool selection recommendations to reach target amounts
    #[clap(long)]
    pub recommend_pools: bool,

    /// Pool selection strategy: 'largest-first' (default) or 'smallest-first'
    #[clap(long, default_value = SELECTION_STRATEGY_LARGEST_FIRST)]
    pub selection_strategy: String,

    /// Only include pools where treasury wallet has associated token accounts for both tokens
    #[clap(long)]
    pub only_ata: bool,

    /// Comma-separated list of token mint addresses to blacklist
    #[clap(long, value_delimiter = ',')]
    pub blacklist_tokens: Vec<String>,
}

#[derive(Debug, Clone, clap::ValueEnum)]
pub enum OutputFormat {
    Json,
    Csv,
    Table,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProtocolFeeInfo {
    pub pool_address: String,
    pub token_x_mint: String,
    pub token_y_mint: String,
    pub protocol_fee_x: u64,
    pub protocol_fee_y: u64,
    pub total_fee_value: u64,
}

#[derive(Debug, Serialize)]
pub struct PoolRecommendation {
    pub token_mint: String,
    pub target_amount: u64,
    pub total_amount: u64,
    pub percentage_over_target: f64,
    pub pools: Vec<ProtocolFeeInfo>,
}

#[derive(Debug)]
pub struct TokenTarget {
    pub token_mint: String,
    pub target_amount: u64,
}

/// Fetch all token accounts for FEE_OWNER and return set of token mints that have ATAs
async fn fetch_existing_token_mints<C, P>(
    program: &Program<C>,
) -> Result<HashSet<Pubkey>>
where
    C: std::ops::Deref<Target = P> + Clone,
    P: anchor_client::solana_sdk::signer::Signer + 'static,
{
    let rpc_client = program.async_rpc();
    let mut existing_mints = HashSet::new();

    let token_programs = vec![anchor_spl::token::spl_token::ID, anchor_spl::token_2022::spl_token_2022::ID];
    
    for &token_program in &token_programs {
        println!("Fetching token accounts for program: {}", token_program);
        
        let token_accounts = match rpc_client
            .get_token_accounts_by_owner(&FEE_OWNER, TokenAccountsFilter::ProgramId(token_program))
            .await
        {
            std::result::Result::Ok(accounts) => accounts,
            Err(e) => {
                println!("Warning: Failed to fetch token accounts for program {}: {}", token_program, e);
                continue;
            }
        };

        println!("Found {} token accounts for program {}", token_accounts.len(), token_program);

        for keyed_account in token_accounts {
            match keyed_account.account.data {
                solana_account_decoder::UiAccountData::Json(parsed_account) => {
                    if let Some(info) = parsed_account.parsed.get("info") {
                        if let Some(mint_str) = info.get("mint").and_then(|v| v.as_str()) {
                            if let std::result::Result::Ok(mint_pubkey) = Pubkey::from_str(mint_str) {
                                existing_mints.insert(mint_pubkey);
                            }
                        }
                    }
                }
                solana_account_decoder::UiAccountData::Binary(_data, solana_account_decoder::UiAccountEncoding::Base64) => {
                    println!("Warning: Received binary token account data when JSON was expected");
                }
                _ => {}
            }
        }
    }

    println!("Total unique token mints with ATAs: {}", existing_mints.len());
    Ok(existing_mints)
}

fn generate_csv_content(results: &[ProtocolFeeInfo]) -> String {
    let mut csv_content = String::from("pool_address,token_x_mint,token_y_mint,protocol_fee_x,protocol_fee_y,total_fee_value\n");
    
    for result in results {
        csv_content.push_str(&format!(
            "{},{},{},{},{},{}\n",
            result.pool_address,
            result.token_x_mint,
            result.token_y_mint,
            result.protocol_fee_x,
            result.protocol_fee_y,
            result.total_fee_value
        ));
    }
    
    csv_content
}

fn generate_summary_csv_content(token_totals: &[(String, u64)]) -> String {
    let mut summary_content = String::from("token_mint,total_amount\n");
    
    for (token_mint, total_amount) in token_totals {
        summary_content.push_str(&format!("{},{}\n", token_mint, total_amount));
    }
    
    summary_content
}

fn generate_recommendations_csv_content(recommendations: &[PoolRecommendation]) -> String {
    let mut rec_content = String::from("target_token,target_amount,total_amount,percentage_over_target,pool_count,pool_addresses\n");
    
    for rec in recommendations {
        let pool_addresses = rec.pools
            .iter()
            .map(|p| p.pool_address.clone())
            .collect::<Vec<_>>()
            .join(";");
            
        rec_content.push_str(&format!(
            "{},{},{},{:.1},{},{}\n",
            rec.token_mint,
            rec.target_amount,
            rec.total_amount,
            rec.percentage_over_target,
            rec.pools.len(),
            pool_addresses
        ));
    }
    
    rec_content
}

fn write_csv_files(
    file_path: &str,
    results: &[ProtocolFeeInfo],
    token_totals: &[(String, u64)],
    recommendations: &[PoolRecommendation],
) -> Result<()> {
    // Write main CSV file
    let csv_content = generate_csv_content(results);
    let mut file = File::create(file_path)?;
    file.write_all(csv_content.as_bytes())?;
    println!("CSV data written to: {}", file_path);

    // Write summary file if we have totals
    if !token_totals.is_empty() {
        let summary_path = file_path.replace(".csv", "_summary.csv");
        let summary_content = generate_summary_csv_content(token_totals);
        let mut summary_file = File::create(&summary_path)?;
        summary_file.write_all(summary_content.as_bytes())?;
        println!("Summary written to: {}", summary_path);
    }

    // Write recommendations file if we have recommendations
    if !recommendations.is_empty() {
        let recommendations_path = file_path.replace(".csv", "_recommendations.csv");
        let rec_content = generate_recommendations_csv_content(recommendations);
        let mut rec_file = File::create(&recommendations_path)?;
        rec_file.write_all(rec_content.as_bytes())?;
        println!("Recommendations written to: {}", recommendations_path);
    }

    Ok(())
}

fn parse_target_amounts(target_amounts_str: &str) -> Result<Vec<TokenTarget>> {
    let mut targets = Vec::new();

    for pair in target_amounts_str.split(',') {
        let parts: Vec<&str> = pair.trim().split(':').collect();
        if parts.len() != 2 {
            return Err(anyhow::anyhow!(
                "Invalid target format. Use 'token_mint1:amount1,token_mint2:amount2'"
            ));
        }

        let token_mint = parts[0].trim().to_string();
        let target_amount = parts[1]
            .trim()
            .parse::<u64>()
            .map_err(|_| anyhow::anyhow!("Invalid target amount: {}", parts[1]))?;

        targets.push(TokenTarget {
            token_mint,
            target_amount,
        });
    }

    Ok(targets)
}

fn find_optimal_pools(
    results: &[ProtocolFeeInfo],
    token_mint: &str,
    target_amount: u64,
    tolerance_percentage: f64,
    selection_strategy: &str,
) -> Option<PoolRecommendation> {
    if tolerance_percentage < 0.0 || tolerance_percentage > 100.0 {
        return None;
    }

    // Filter pools that contain the target token
    let relevant_pools: Vec<&ProtocolFeeInfo> = results
        .iter()
        .filter(|pool| {
            (pool.token_x_mint == token_mint && pool.protocol_fee_x > 0)
                || (pool.token_y_mint == token_mint && pool.protocol_fee_y > 0)
        })
        .collect();

    if relevant_pools.is_empty() {
        return None;
    }

    // Extract fee amounts for the target token
    let mut pool_amounts: Vec<(u64, &ProtocolFeeInfo)> = relevant_pools
        .iter()
        .map(|pool| {
            let amount = if pool.token_x_mint == token_mint {
                pool.protocol_fee_x
            } else {
                pool.protocol_fee_y
            };
            (amount, *pool)
        })
        .collect();

    // Sort based on selection strategy
    match selection_strategy {
        SELECTION_STRATEGY_SMALLEST_FIRST => pool_amounts.sort_by(|a, b| a.0.cmp(&b.0)),
        _ => pool_amounts.sort_by(|a, b| b.0.cmp(&a.0)), // Default: largest first
    }

    let min_target = ((target_amount as f64) * (1.0 - tolerance_percentage / 100.0)) as u64;

    // Try to find the best combination using improved greedy algorithm
    let best_combination = find_best_combination(&pool_amounts, target_amount, min_target)?;

    let percentage_over =
        ((best_combination.total_amount as f64 / target_amount as f64) - 1.0) * 100.0;

    Some(PoolRecommendation {
        token_mint: token_mint.to_string(),
        target_amount,
        total_amount: best_combination.total_amount,
        percentage_over_target: percentage_over,
        pools: best_combination.pools,
    })
}

// Experimental algorithmic functions
#[derive(Debug, Clone)]
struct PoolCombination {
    pools: Vec<ProtocolFeeInfo>,
    total_amount: u64,
}

fn find_best_combination(
    pool_amounts: &[(u64, &ProtocolFeeInfo)],
    target_amount: u64,
    min_target: u64,
) -> Option<PoolCombination> {
    if pool_amounts.len() <= MAX_POOLS_FOR_COMPLEX_ALGORITHM {
        try_greedy_with_backtrack(pool_amounts, target_amount, min_target)
    } else {
        try_greedy_approach(pool_amounts, target_amount, min_target)
    }
}

fn calculate_distance(amount: u64, target: u64) -> u64 {
    if amount >= target {
        amount - target
    } else {
        target - amount
    }
}

fn try_greedy_approach(
    pool_amounts: &[(u64, &ProtocolFeeInfo)],
    target_amount: u64,
    min_target: u64,
) -> Option<PoolCombination> {
    let mut selected_pools = Vec::new();
    let mut total_amount = 0u64;

    for (amount, pool) in pool_amounts {
        selected_pools.push((**pool).clone());
        total_amount += amount;

        // Stop when we reach the target (don't overshoot unnecessarily)
        if total_amount >= target_amount {
            break;
        }
    }

    if total_amount >= min_target {
        Some(PoolCombination {
            pools: selected_pools,
            total_amount,
        })
    } else {
        None
    }
}

fn try_greedy_with_backtrack(
    pool_amounts: &[(u64, &ProtocolFeeInfo)],
    target_amount: u64,
    min_target: u64,
) -> Option<PoolCombination> {
    let greedy = try_greedy_approach(pool_amounts, target_amount, min_target)?;
    
    if greedy.total_amount <= target_amount * 110 / 100 {
        return Some(greedy);
    }

    // Try to optimize by removing largest pools that cause significant overshoot
    let overshoot = greedy.total_amount.saturating_sub(target_amount);
    let best = greedy.clone();
    let best_distance = calculate_distance(best.total_amount, target_amount);

    for i in 0..best.pools.len() {
        let pool = &best.pools[i];
        let pool_amount = if pool.token_x_mint == pool_amounts[0].1.token_x_mint {
            pool.protocol_fee_x
        } else {
            pool.protocol_fee_y
        };

        if pool_amount > overshoot / 2 {
            let new_total = best.total_amount - pool_amount;
            if new_total >= min_target {
                let distance = calculate_distance(new_total, target_amount);
                if distance < best_distance {
                    let mut new_pools = best.pools.clone();
                    new_pools.remove(i);
                    return Some(PoolCombination {
                        pools: new_pools,
                        total_amount: new_total,
                    });
                }
            }
        }
    }

    Some(best)
}


pub async fn execute_query_protocol_fees_by_tokens<C, P>(
    params: QueryProtocolFeesByTokensParams,
    program: &Program<C>,
) -> Result<()>
where
    C: std::ops::Deref<Target = P> + Clone,
    P: anchor_client::solana_sdk::signer::Signer + 'static,
{
    if params.under_target_tolerance < 0.0 || params.under_target_tolerance > 100.0 {
        return Err(anyhow::anyhow!("Under target tolerance must be between 0 and 100"));
    }

    println!(
        "Querying protocol fees for {} token mints...",
        params.token_mints.len()
    );

    let mut token_filter: HashSet<Pubkey> = HashSet::new();
    for mint_str in &params.token_mints {
        let pubkey = Pubkey::from_str(mint_str)
            .map_err(|e| anyhow::anyhow!("Invalid pubkey '{}': {}", mint_str, e))?;
        token_filter.insert(pubkey);
    }

    println!(">>> Fetching all LB pair accounts...");
    let accounts = fetch_lb_pair_accounts(program).await?;
    println!(" Found {} LB pair accounts, filtering...", accounts.len());

    // Fetch all token accounts for FEE_OWNER if ATA filtering is enabled
    let existing_ata_mints = if params.only_ata {
        println!(">>> Fetching all token accounts for FEE_OWNER to optimize ATA filtering...");
        Some(fetch_existing_token_mints(program).await?)
    } else {
        None
    };
    
    // Filter and process pools with optional ATA pre-filtering
    let final_results = filter_and_process_pools(accounts, &token_filter, &params, existing_ata_mints.as_ref());

    let results = final_results;

    let (token_totals, sorted_totals) = calculate_token_totals(&results, &params.token_mints);
    
    println!("Found {} pools with matching criteria", results.len());
    display_token_totals(&sorted_totals);

    // Handle pool recommendations for target amounts if requested
    let mut recommendations = Vec::new();
    if params.recommend_pools {
        if let Some(target_amounts_str) = &params.target_amounts {
            let targets = parse_target_amounts(target_amounts_str)?;

            let available_tokens: HashSet<String> = token_totals.keys().cloned().collect();
            validate_targets_and_strategy(&targets, &available_tokens, &params.selection_strategy)?;

            println!("Pool Recommendations:");
            println!("===================");
            println!("Strategy: {}", params.selection_strategy);
            println!(
                "Under-target tolerance: {:.1}%",
                params.under_target_tolerance
            );
            println!();

            for target in targets {
                let available_amount = token_totals.get(&target.token_mint).unwrap_or(&0);

                if target.target_amount > *available_amount {
                    println!(
                        "Cannot reach target for token: {} (target: {}, available: {})",
                        target.token_mint, target.target_amount, available_amount
                    );
                    continue;
                }

                if let Some(recommendation) = find_optimal_pools(
                    &results,
                    &target.token_mint,
                    target.target_amount,
                    params.under_target_tolerance,
                    &params.selection_strategy,
                ) {
                    println!(
                        "Target: {} - {}",
                        recommendation.token_mint, recommendation.target_amount
                    );
                    println!(
                        "Recommended pools to claim ({} pools):",
                        recommendation.pools.len()
                    );

                    for pool in &recommendation.pools {
                        let fee_amount = if pool.token_x_mint == recommendation.token_mint {
                            pool.protocol_fee_x
                        } else {
                            pool.protocol_fee_y
                        };
                        println!(
                            "  • Pool {}: {} tokens",
                            &pool.pool_address[..8],
                            fee_amount
                        );
                    }

                    let status_text = if recommendation.percentage_over_target >= 0.0 {
                        "(meets target)"
                    } else {
                        "(under target but within tolerance)"
                    };

                    println!(
                        "Total: {} ({:+.1}% vs target) {}",
                        recommendation.total_amount,
                        recommendation.percentage_over_target,
                        status_text
                    );

                    recommendations.push(recommendation);
                    println!();
                } else {
                    println!(
                        "Cannot find suitable combination for token: {} (target: {})",
                        target.token_mint, target.target_amount
                    );
                    println!("   Available amount: {}", available_amount);
                    println!(
                        "   This might be due to tolerance constraints or algorithm limitations"
                    );
                    println!();
                }
            }
        } else {
            println!("Warning: To use --recommend-pools, you must specify --target-amounts");
            println!("   Example: --target-amounts \"So11111111111111111111111111111111111111112:1000000000\"");
            println!("   Multiple targets: --target-amounts \"tokenA:1000,tokenB:2000\"");
            println!();
        }
    }

    // Output results in requested format
    match params.output_format {
        OutputFormat::Json => {
            let json = serde_json::to_string_pretty(&results)?;
            println!("{}", json);
        }
        OutputFormat::Csv => {
            if let Some(file_path) = &params.csv_output_file {
                write_csv_files(file_path, &results, &sorted_totals, &recommendations)?;
                println!("Total records: {}", results.len());
            } else {
                let csv_content = generate_csv_content(&results);
                print!("{}", csv_content);
            }
        }
        OutputFormat::Table => {
            if results.is_empty() {
                println!("No pools found matching the criteria");
                return Ok(());
            }

            println!();
            println!(
                "{:<44} {:<44} {:<44} {:>15} {:>15} {:>15}",
                "Pool Address",
                "Token X Mint",
                "Token Y Mint",
                "Protocol Fee X",
                "Protocol Fee Y",
                "Total Value"
            );
            println!("{}", "-".repeat(44 * 3 + 15 * 3 + 10));

            for result in &results {
                println!(
                    "{:<44} {:<44} {:<44} {:>15} {:>15} {:>15}",
                    result.pool_address,
                    result.token_x_mint,
                    result.token_y_mint,
                    result.protocol_fee_x,
                    result.protocol_fee_y,
                    result.total_fee_value
                );
            }
        }
    }

    // If CSV output file is specified and we're not in CSV format, still save CSV data
    if let Some(file_path) = &params.csv_output_file {
        if !matches!(params.output_format, OutputFormat::Csv) {
            write_csv_files(file_path, &results, &sorted_totals, &recommendations)?;
            println!("\nCSV data also saved to: {}", file_path);
        }
    }

    Ok(())
}

fn fetch_lb_pair_accounts<C, P>(
    program: &Program<C>,
) -> impl std::future::Future<Output = Result<Vec<(Pubkey, LbPair)>>> + '_
where
    C: std::ops::Deref<Target = P> + Clone,
    P: anchor_client::solana_sdk::signer::Signer + 'static,
{
    async move {
        let rpc_client = program.async_rpc();
        let account_config = RpcAccountInfoConfig {
            encoding: Some(UiAccountEncoding::Base64),
            ..Default::default()
        };
        let config = RpcProgramAccountsConfig {
            filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_base58_encoded(
                0,
                &LB_PAIR_ACCOUNT_DISCM,
            ))]),
            account_config,
            ..Default::default()
        };

        Ok(rpc_client
            .get_program_accounts_with_config(&dlmm_interface::ID, config)
            .await?
            .into_iter()
            .filter_map(|(key, account)| {
                LbPairAccount::deserialize(&account.data)
                    .ok()
                    .map(|lb_pair_account| (key, lb_pair_account.0))
            })
            .collect())
    }
}

fn filter_and_process_pools(
    accounts: Vec<(Pubkey, LbPair)>,
    token_filter: &HashSet<Pubkey>,
    params: &QueryProtocolFeesByTokensParams,
    ata_filter: Option<&HashSet<Pubkey>>,
) -> Vec<ProtocolFeeInfo> {
    let mut results = Vec::new();
    let mut excluded_ata_count = 0;

    // Create blacklist from default and CLI tokens
    let mut blacklist = HashSet::new();
    for token in DEFAULT_BLACKLISTED_TOKENS {
        if let std::result::Result::Ok(pubkey) = Pubkey::from_str(token) {
            blacklist.insert(pubkey);
        }
    }
    for token in &params.blacklist_tokens {
        if let std::result::Result::Ok(pubkey) = Pubkey::from_str(token) {
            blacklist.insert(pubkey);
        }
    }

    for (pubkey, lb_pair) in accounts {
        // Skip if either token is blacklisted
        if blacklist.contains(&lb_pair.token_x_mint) || blacklist.contains(&lb_pair.token_y_mint) {
            continue;
        }

        let token_x_matches = token_filter.is_empty() || token_filter.contains(&lb_pair.token_x_mint);
        let token_y_matches = token_filter.is_empty() || token_filter.contains(&lb_pair.token_y_mint);

        if !token_x_matches && !token_y_matches {
            continue;
        }

        // Apply ATA filter if --only-ata flag is set
        if let Some(existing_ata_mints) = ata_filter {
            let x_has_ata = existing_ata_mints.contains(&lb_pair.token_x_mint);
            let y_has_ata = existing_ata_mints.contains(&lb_pair.token_y_mint);
            
            // Only include pools where both tokens have ATAs
            if !x_has_ata || !y_has_ata {
                excluded_ata_count += 1;
                continue;
            }
        }

        let protocol_fee_x = lb_pair.protocol_fee.amount_x;
        let protocol_fee_y = lb_pair.protocol_fee.amount_y;

        if let Some(ref thresholds) = params.min_fee_threshold {
            let token_x_mint_str = lb_pair.token_x_mint.to_string();
            let token_y_mint_str = lb_pair.token_y_mint.to_string();
            
            let x_threshold = thresholds.get(&token_x_mint_str);
            let y_threshold = thresholds.get(&token_y_mint_str);

            let x_fails = x_threshold.map_or(false, |&threshold| protocol_fee_x < threshold);
            let y_fails = y_threshold.map_or(false, |&threshold| protocol_fee_y < threshold);
            
            // Skip pool if any specified token fails its threshold
            if x_fails || y_fails {
                continue;
            }
        }

        if params.non_zero_only && protocol_fee_x == 0 && protocol_fee_y == 0 {
            continue;
        }

        let total_fee_value = protocol_fee_x.saturating_add(protocol_fee_y);

        results.push(ProtocolFeeInfo {
            pool_address: pubkey.to_string(),
            token_x_mint: lb_pair.token_x_mint.to_string(),
            token_y_mint: lb_pair.token_y_mint.to_string(),
            protocol_fee_x,
            protocol_fee_y,
            total_fee_value,
        });
    }

    // Show ATA filtering summary if enabled
    if ata_filter.is_some() && excluded_ata_count > 0 {
        println!("ATA filtering: excluded {} pools due to missing token accounts", excluded_ata_count);
    }

    results.sort_by(|a, b| b.total_fee_value.cmp(&a.total_fee_value));
    results
}

fn calculate_token_totals(
    results: &[ProtocolFeeInfo],
    target_token_mints: &[String],
) -> (HashMap<String, u64>, Vec<(String, u64)>) {
    let mut token_totals: HashMap<String, u64> = HashMap::new();
    
    for result in results {
        *token_totals.entry(result.token_x_mint.clone()).or_insert(0) += result.protocol_fee_x;
        *token_totals.entry(result.token_y_mint.clone()).or_insert(0) += result.protocol_fee_y;
    }

    let filtered_totals: HashMap<String, u64> = token_totals
        .iter()
        .filter(|(token_mint, _)| target_token_mints.contains(token_mint))
        .map(|(k, v)| (k.clone(), *v))
        .collect();

    let mut sorted_totals: Vec<(String, u64)> = filtered_totals.into_iter().collect();
    sorted_totals.sort_by(|a, b| b.1.cmp(&a.1));

    (token_totals, sorted_totals)
}

fn display_token_totals(sorted_totals: &[(String, u64)]) {
    if !sorted_totals.is_empty() {
        println!("\nProtocol fees for specified token mints:");
        for (token_mint, total_amount) in sorted_totals {
            println!("  {}: {}", token_mint, total_amount);
        }
        println!();
    }
}

fn validate_targets_and_strategy(
    targets: &[TokenTarget],
    available_tokens: &HashSet<String>,
    selection_strategy: &str,
) -> Result<()> {
    if targets.is_empty() {
        return Err(anyhow::anyhow!("No target amounts specified"));
    }
    let invalid_targets: Vec<&String> = targets
        .iter()
        .map(|target| &target.token_mint)
        .filter(|token| !available_tokens.contains(*token))
        .collect();

    if !invalid_targets.is_empty() {
        return Err(anyhow::anyhow!(
            "Target tokens not found in any pools: {:?}. Available tokens: {:?}",
            invalid_targets,
            available_tokens
        ));
    }

    if !matches!(
        selection_strategy,
        SELECTION_STRATEGY_LARGEST_FIRST | SELECTION_STRATEGY_SMALLEST_FIRST
    ) {
        return Err(anyhow::anyhow!(
            "Invalid selection strategy '{}'. Must be '{}' or '{}'",
            selection_strategy,
            SELECTION_STRATEGY_LARGEST_FIRST,
            SELECTION_STRATEGY_SMALLEST_FIRST
        ));
    }

    Ok(())
}
