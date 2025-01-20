cluster=https://api.mainnet-beta.solana.com
lb_pair=[Pool pk]
owner=[Owner pk]

operator_kp=~/.config/solana/id.json
priority_fee=1000

# get all positions
# ./target/debug/cli --provider.cluster $cluster get-all-positions-for-an-owner --lb-pair $lb_pair --owner $owner

# claim fee
position=[Position pk]
./target/debug/cli --provider.cluster $cluster --provider.wallet $operator_kp --priority-fee $priority_fee claim-fee $position