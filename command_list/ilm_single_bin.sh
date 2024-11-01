#!/bin/bash

cluster="https://api.mainnet-beta.solana.com"
# cluster="http://localhost:8899"

# ILM parameters
bin_step=80
base_fee_bps=300
price=0.03

# Activation type. 0 = Slot, 1 = Timestamp
activation_type=0
# Pool start trading time/slot
activation_point=10000
# Pool start price rounding if the price cannot be exact. "up", "down", "none". None will terminate the script if the price cannot be exact.
price_rounding="up"

# Pool token mints
base_mint="Cu9VgXuDujQpczwhn89SyssKtMziyv2McBXLBf3uC7N4"
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
../target/debug/cli initialize-customizable-permissionless-lb-pair --bin-step $bin_step --token-mint-x $base_mint --token-mint-y $quote_mint --initial-price $price \
 --base-fee-bps $base_fee_bps --activation-type $activation_type --selective-rounding "up" --activation-point $activation_point \
 --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport

#  Initialize pair with alpha vault
../target/debug/cli initialize-customizable-permissionless-lb-pair --bin-step $bin_step --token-mint-x $base_mint --token-mint-y $quote_mint --initial-price $price \
 --base-fee-bps $base_fee_bps --activation-type $activation_type --selective-rounding "up" --activation-point $activation_point --has-alpha-vault \
 --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport

# Get from initialize pair
pair="J4ed5J3qxQPpdLFz2pjwQur1TDwHEtVwtzFefUbenxAJ"

# Seed liquidity
../target/debug/cli seed-liquidity-single-bin --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --price $price --selective-rounding $price_rounding --position-owner-path $position_owner_path \
 --provider.cluster $cluster --provider.wallet $position_owner_path --priority-fee $priority_fee_microlamport