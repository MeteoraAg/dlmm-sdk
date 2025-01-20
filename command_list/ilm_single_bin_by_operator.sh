#!/bin/bash
cluster="https://api.devnet.solana.com"
# Get from initialize pair
pair="[LB pair public key]"

# Liquidity for seeding. UI amount.
amount=1000000
# Price
price=0.25
# Pool start price rounding if the price cannot be exact. "up", "down", "none". None will terminate the script if the price cannot be exact.
price_rounding="up"

# Keypair paths
# Position owner keypair path
position_owner="[Position owner public key]"
fee_owner="[Fee owner public key]"
lock_release_point=0

# Base position keypair path
base_position_path="deployer.json"
operator_kp_path="deployer.json"
# Get base_position_path pubkey by solana-keygen pubkey <base_position_path>
base_position_key="[Address of deployer.json]"
priority_fee_microlamport=100000

# Seed liquidity
./target/debug/cli seed-liquidity-single-bin-by-operator --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --price $price --position-owner $position_owner --fee-owner $fee_owner --lock-release-point $lock_release_point --selective-rounding $price_rounding\
 --provider.cluster $cluster --provider.wallet $operator_kp_path --priority-fee $priority_fee_microlamport