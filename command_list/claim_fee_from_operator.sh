cluster=https://api.mainnet-beta.solana.com
operator_kp=~/.config/solana/id.json
priority_fee=1000

position=[Position pk]
./target/debug/cli --provider.cluster $cluster --provider.wallet $operator_kp --priority-fee $priority_fee claim-fee $position

# get all positions
# lb_pair=[Pool pk]
# owner=[Owner pk]
# ./target/debug/cli --provider.cluster $cluster get-all-positions-for-an-owner --lb-pair $lb_pair --owner $owner

