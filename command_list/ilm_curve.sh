#!/bin/bash

cluster="https://api.devnet.solana.com"
# cluster="http://localhost:8899"

# Get from initialize pair
pair="[LB pair public key]"

min_price=0.003
max_price=0.03
curvature=0.6

# Liquidity for seeding. UI amount.
amount=150000000

# Keypair paths
# Position owner keypair path
position_owner_path="[Position owner keypair path]"

# Base position keypair path
base_position_path="[Base keypair path]"

# Get base_position_path pubkey by solana-keygen pubkey <base_position_path>
base_position_key="[Base public key]"

priority_fee_microlamport=100000

max_retries=1000

# Seed liquidity
./target/debug/cli seed-liquidity --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --min-price $min_price --max-price $max_price --position-owner-path $position_owner_path --curvature $curvature \
 --max-retries $max_retries --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport