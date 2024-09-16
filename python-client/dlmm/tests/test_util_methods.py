from dlmm.dlmm import DLMM, DLMM_CLIENT
from solana.rpc.api import Client
from solders.pubkey import Pubkey
from dlmm.types import FeeInfo, GetBins
from solders.keypair import Keypair
from solana.transaction import Transaction

def test_util_methods():
    RPC = "https://api.devnet.solana.com"
    pool_address = Pubkey.from_string("3W2HKgUa96Z69zzG3LK1g8KdcRAWzAttiLiHfYnKuPw5")
    # client = Client(RPC)
    dlmm = DLMM_CLIENT.create(pool_address, RPC)
    assert isinstance(dlmm, DLMM)

    user = Keypair.from_bytes([3, 65, 174, 194, 140, 162, 138, 46, 167, 188, 153, 227, 110, 110, 82, 167, 238, 92, 174, 250, 66, 104, 188, 196, 164, 72, 222, 202, 150, 52, 38, 249, 205, 59, 43, 173, 101, 40, 208, 183, 241, 9, 237, 75, 52, 240, 165, 65, 91, 247, 233, 207, 170, 155, 162, 181, 215, 135, 103, 2, 132, 32, 196, 16])
    new_balance_position = Keypair.from_bytes([32, 144, 75, 246, 203, 27, 190, 52, 136, 171, 135, 250, 125, 246, 242, 26, 67, 40, 71, 23, 206, 192, 101, 86, 155, 59, 121, 96, 14, 59, 50, 215, 212, 236, 210, 249, 79, 133, 198, 35, 7, 150, 118, 47, 206, 4, 220, 255, 79, 208, 248, 233, 179, 231, 209, 204, 139, 232, 20, 116, 66, 48, 2, 49])

    bin_arrays = dlmm.get_bin_arrays()
    assert type(bin_arrays) == list

    fee_info = dlmm.get_fee_info()
    assert isinstance(fee_info, FeeInfo)

    dynamic_fee = dlmm.get_dynamic_fee()
    assert type(dynamic_fee) == float

    check_bin = bin_arrays[0]["account"]["bins"][0]
    bin_id = dlmm.get_bin_id_from_price(float(check_bin["price"]), True)
    assert isinstance(bin_id, int) or bin_id is None

    bins_around_active = dlmm.get_bins_around_active_bin(0, 0)
    assert isinstance(bins_around_active, GetBins)

    bins_between_upper_lower = dlmm.get_bins_between_lower_and_upper_bound(0, 2)
    assert isinstance(bins_between_upper_lower, GetBins)

    bins_between_min_max = dlmm.get_bins_between_min_and_max_price(0.0, 50.0)
    assert isinstance(bins_between_min_max, GetBins)

    positions = dlmm.get_positions_by_user_and_lb_pair(user.pubkey())
    user_positions = next(filter(lambda x: x.public_key == new_balance_position.pubkey() ,positions.user_positions), None)
    if user_positions:
        claim_lm = dlmm.claim_LM_reward(new_balance_position.pubkey(), user_positions)
        assert isinstance(claim_lm, Transaction)

        claim_swap_fee = dlmm.claim_swap_fee(new_balance_position.pubkey(), user_positions)
        assert isinstance(claim_swap_fee, Transaction)



