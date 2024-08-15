import pytest
from dlmm import DLMM_CLIENT
from dlmm.types import GetPositionByUser, StrategyType
from solders.keypair import Keypair
from solana.rpc.api import Client
from solana.transaction import Transaction

def test_flow():
    RPC = "https://api.devnet.solana.com"
    pool_address = "3W2HKgUa96Z69zzG3LK1g8KdcRAWzAttiLiHfYnKuPw5"
    client = Client(RPC)
    dlmm = DLMM_CLIENT(pool_address, RPC)
    assert isinstance(dlmm, DLMM_CLIENT)

    active_bin = dlmm.get_active_bin()
    print(active_bin.price)
    active_bin_price_per_token = dlmm.from_price_per_lamport(active_bin.price)
    print(active_bin_price_per_token)
    assert type(active_bin_price_per_token) == float

    user = Keypair.from_bytes([3, 65, 174, 194, 140, 162, 138, 46, 167, 188, 153, 227, 110, 110, 82, 167, 238, 92, 174, 250, 66, 104, 188, 196, 164, 72, 222, 202, 150, 52, 38, 249, 205, 59, 43, 173, 101, 40, 208, 183, 241, 9, 237, 75, 52, 240, 165, 65, 91, 247, 233, 207, 170, 155, 162, 181, 215, 135, 103, 2, 132, 32, 196, 16])
    new_balance_position = Keypair()
    total_interval_range = 10
    max_bin_id = active_bin.bin_id + total_interval_range
    min_bin_id = active_bin.bin_id - total_interval_range
    total_x_amount = 100
    total_y_amount = total_x_amount * int(active_bin_price_per_token)

    position_tx = dlmm.initialize_position_and_add_liquidity_by_strategy(
        new_balance_position.pubkey(), 
        user.pubkey(), 
        total_x_amount, 
        total_y_amount, 
        {
            "max_bin_id": max_bin_id, 
            "min_bin_id": min_bin_id, 
            "strategy_type": StrategyType.SpotBalanced.value
        })
    assert isinstance(position_tx, Transaction)

    # client.send_transaction(position_tx, user)
    print("Transaction sent")

    positions = dlmm.get_positions_by_user_and_lb_pair(user.pubkey())
    assert isinstance(positions, GetPositionByUser)

    add_liquidity_tx = dlmm.add_liquidity_by_strategy(
        new_balance_position.pubkey(), 
        user.pubkey(), 
        total_x_amount, 
        total_y_amount, 
        {
            "max_bin_id": max_bin_id, 
            "min_bin_id": min_bin_id, 
            "strategy_type": StrategyType.SpotBalanced.value
        })
    assert isinstance(add_liquidity_tx, Transaction)

    # client.send_transaction(add_liquidity_tx, user)
    




if __name__ == "__main__":
    test_flow()