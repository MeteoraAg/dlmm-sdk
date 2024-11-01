#!/bin/bash

cluster="https://api.mainnet-beta.solana.com"
# cluster="http://localhost:8899"

# ILM parameters
bin_step=80
base_fee_bps=300
min_price=0.003
max_price=0.03
curvature=0.8

# Activation type. 0 = Slot, 1 = Timestamp
activation_type=0
# Pool start trading time/slot
activation_point=10000

# Pool token mints
base_mint="2u1Yr1D4upwkwpS8KAPLf9nRLRa95PiycoZNRiqQ2QSm"
quote_mint="So11111111111111111111111111111111111111112"

# Liquidity for seeding. UI amount.
amount=150000000

# Keypair paths
# Position owner keypair path
position_owner_path="../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json"

# Base position keypair path
base_position_path="../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json"

# Get base_position_path pubkey by solana-keygen pubkey <base_position_path>
base_position_key="bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1"

priority_fee_microlamport=100000

# Initialize pair without alpha vault
../target/debug/cli initialize-customizable-permissionless-lb-pair --bin-step $bin_step --token-mint-x $base_mint --token-mint-y $quote_mint --initial-price $min_price \
 --base-fee-bps $base_fee_bps --activation-type $activation_type --selective-rounding "up" --activation-point $activation_point \
 --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport

 # Initialize pair with alpha vault
../target/debug/cli initialize-customizable-permissionless-lb-pair --bin-step $bin_step --token-mint-x $base_mint --token-mint-y $quote_mint --initial-price $min_price \
 --base-fee-bps $base_fee_bps --activation-type $activation_type --selective-rounding "up" --activation-point $activation_point --has-alpha-vault \
 --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport

# Get from initialize pair
pair="EadLEzY46oiqvC93w9oT9GnHGgpwpN2X27Mqyts9khXV"

max_retries=1000

# Seed liquidity
../target/debug/cli seed-liquidity --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --min-price $min_price --max-price $max_price --position-owner-path $position_owner_path --curvature $curvature \
 --max-retries $max_retries --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport