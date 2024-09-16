import pytest
from dlmm import DLMM_CLIENT
from dlmm.dlmm import DLMM
from dlmm.types import GetPositionByUser, StrategyType, SwapQuote
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solana.rpc.api import Client
from solana.transaction import Transaction

def test_flow():
    RPC = "https://api.devnet.solana.com"
    pool_address = Pubkey.from_string("3W2HKgUa96Z69zzG3LK1g8KdcRAWzAttiLiHfYnKuPw5")
    client = Client(RPC)
    dlmm = DLMM_CLIENT.create(pool_address, RPC)
    assert isinstance(dlmm, DLMM)

    active_bin = dlmm.get_active_bin()
    active_bin_price_per_token = dlmm.from_price_per_lamport(active_bin.price)
    assert type(active_bin_price_per_token) == float

    user = Keypair.from_bytes([3, 65, 174, 194, 140, 162, 138, 46, 167, 188, 153, 227, 110, 110, 82, 167, 238, 92, 174, 250, 66, 104, 188, 196, 164, 72, 222, 202, 150, 52, 38, 249, 205, 59, 43, 173, 101, 40, 208, 183, 241, 9, 237, 75, 52, 240, 165, 65, 91, 247, 233, 207, 170, 155, 162, 181, 215, 135, 103, 2, 132, 32, 196, 16])
    new_balance_position = Keypair.from_bytes([32, 144, 75, 246, 203, 27, 190, 52, 136, 171, 135, 250, 125, 246, 242, 26, 67, 40, 71, 23, 206, 192, 101, 86, 155, 59, 121, 96, 14, 59, 50, 215, 212, 236, 210, 249, 79, 133, 198, 35, 7, 150, 118, 47, 206, 4, 220, 255, 79, 208, 248, 233, 179, 231, 209, 204, 139, 232, 20, 116, 66, 48, 2, 49])
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
            "strategy_type": StrategyType.SpotBalanced
        })

    assert isinstance(position_tx, Transaction)

    client.send_transaction(position_tx, user, new_balance_position)
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
            "strategy_type": StrategyType.SpotBalanced
        })
    assert isinstance(add_liquidity_tx, Transaction)

    client.send_transaction(add_liquidity_tx, user)
    print("Transaction sent")

    user_positions = next(filter(lambda x: x.public_key == new_balance_position.pubkey() ,positions.user_positions), None)

    if user_positions:
        bin_ids_to_remove = list(map(lambda x: x.bin_id, user_positions.position_data.position_bin_data))
        remove_liquidity = dlmm.remove_liqidity(
            new_balance_position.pubkey(), 
            user.pubkey(), 
            bin_ids_to_remove,
            100*100,
            True
        )
        assert isinstance(remove_liquidity, list)
        client.send_transaction(remove_liquidity, user)

    swap_amount = 100
    swap_y_to_x = True
    bin_arrays = dlmm.get_bin_array_for_swap(swap_y_to_x)
    swap_quote = dlmm.swap_quote(swap_amount, swap_y_to_x, 10, bin_arrays)
    assert isinstance(swap_quote, SwapQuote)

    swap_tx = dlmm.swap(
        dlmm.token_X.public_key,
        dlmm.token_Y.public_key,
        swap_amount,
        swap_quote.min_out_amount,
        dlmm.pool_address,
        user.pubkey(),
        swap_quote.bin_arrays_pubkey
        )
    assert isinstance(swap_tx, Transaction)

    client.send_transaction(swap_tx, user)


    