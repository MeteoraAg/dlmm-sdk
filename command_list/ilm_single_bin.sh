#!/bin/bash

cluster="https://api.devnet.solana.com"

# Get from initialize pair
pair="[LB pair public key]"
# price
price=0.03
# Pool start price rounding if the price cannot be exact. "up", "down", "none". None will terminate the script if the price cannot be exact.
price_rounding="up"
# Liquidity for seeding. UI amount.
amount=150000000

# Keypair paths
# Position owner keypair path
position_owner_path="[Position owner keypair path]"
# Base position keypair path
base_position_path="[Base position keypair path]"
# Get base_position_path pubkey by solana-keygen pubkey <base_position_path>
base_position_key="[Base public key]"
priority_fee_microlamport=100000


# Seed liquidity
./target/debug/cli seed-liquidity-single-bin --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --price $price --selective-rounding $price_rounding --position-owner-path $position_owner_path \
 --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport