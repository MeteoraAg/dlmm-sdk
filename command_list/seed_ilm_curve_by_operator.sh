#!/bin/bash

cluster="https://api.mainnet-beta.solana.com"
# cluster="http://localhost:8899"

# ILM parameters
bin_step=80
base_fee_bps=300
min_price=0.003
max_price=0.03
curvature=0.8

# Pool token mints
base_mint="ENPCBkoLSxAXcqu916pc1wrfVfqP6Fu5qbr9nJLnKFsV"
quote_mint="So11111111111111111111111111111111111111112"

# Liquidity for seeding. UI amount.
amount=150000000

# Keypair paths
# Position owner keypair path
owner="bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1"
fee_owner="bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1"
lock_release_point=0

# Base position keypair path
base_position_path="../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json"
operator_kp_path="../keys/localnet/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json"
# Get base_position_path pubkey by solana-keygen pubkey <base_position_path>
base_position_key="bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1"

priority_fee_microlamport=100000

# Get from initialize pair
pair="3ZcwH1XJTeozxrr3gbK3GYuNPpeG6SPZcwM9vpgPJj7b"

max_retries=1000

# Seed liquidity
../target/debug/cli seed-liquidity-by-operator --lb-pair $pair --base-position-path $base_position_path --base-pubkey $base_position_key --amount $amount \
 --min-price $min_price --max-price $max_price --curvature $curvature --owner $owner --fee-owner $fee_owner --lock-release-point $lock_release_point\
 --max-retries $max_retries --provider.cluster $cluster --provider.wallet $operator_kp_path --priority-fee $priority_fee_microlamport