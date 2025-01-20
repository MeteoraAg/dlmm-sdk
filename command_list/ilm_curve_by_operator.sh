#!/bin/bash
cluster="https://api.devnet.solana.com"

# Get from initialize pair
pair="[LB pair public key]"

# ILM parameters
min_price=0.003
max_price=0.03
curvature=0.8
# Liquidity for seeding. UI amount.
amount=150000000
# Keypair paths
# Position owner public key
position_owner="[Position owner public key]"
# Fee owner public key
fee_owner="[Fee owner public key]"
# Lock release point, the point when position can be withdraw
lock_release_point=0
# Base position keypair path
base_position_path="[Base position keypair path (can be the same with operator kp path)]"
# Deployer keypair path
operator_kp_path="[Deployer keypair path]"
# Get base_position_path pubkey by solana-keygen pubkey <base_position_path>
base_position_key="[Base public key]"
priority_fee_microlamport=100000
max_retries=1000

# Seed liquidity
./target/debug/cli seed-liquidity-by-operator --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --min-price $min_price --max-price $max_price --curvature $curvature --position-owner $position_owner --fee-owner $fee_owner --lock-release-point $lock_release_point\
 --max-retries $max_retries --provider.cluster $cluster --provider.wallet $operator_kp_path --priority-fee $priority_fee_microlamport