#!/bin/bash

cluster="https://api.devnet.solana.com"

pair="[LB pair public key]"
pool_creator_path="[Pool creator keypair path]"

# enable / disable pool
enable=false

if $enable 
then
    ./target/debug/cli set-pair-status-permissionless --lb-pair $pair --enable --provider.cluster $cluster --provider.wallet $pool_creator_path
else
    ./target/debug/cli set-pair-status-permissionless --lb-pair $pair --provider.cluster $cluster --provider.wallet $pool_creator_path
fi
