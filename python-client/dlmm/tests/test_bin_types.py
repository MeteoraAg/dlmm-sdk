"""Offline checks for the bin JSON returned by both HTTP array endpoints."""
from dlmm.types import Bin, BinArray


def current_bin():
    return {
        "amountX": "20000000000001", "amountY": "00", "price": "010000000000000000",
        "liquiditySupply": "10", "feeAmountXPerTokenStored": "00",
        "feeAmountYPerTokenStored": "00", "rewardPerTokenStored": ["00", "01"],
        "fulfilledOrderAmountX": "02", "fulfilledOrderAmountY": "03",
        "limitOrderFeeAskSide": "04", "limitOrderFeeBidSide": "05",
        "openOrderAmount": "20000000000001", "totalProcessingOrderAmount": "06",
        "processedOrderRemainingAmount": "07", "orderAge": 8, "limitOrderAskSide": 1,
    }


def test_current_bin_array_preserves_current_fields_and_large_integers():
    array = BinArray({"publicKey": "pool-array", "account": {"index": "-01", "bins": [current_bin()]}})
    bin = array.account.bins[0]
    assert array.account.index == -1
    assert bin.amount_x == 9007199254740993
    assert bin.open_order_amount == 9007199254740993
    assert bin.processed_order_remaining_amount == 7
    assert bin.total_processing_order_amount == 6
    assert bin.fulfilled_order_amount_x == 2
    assert bin.fulfilled_order_amount_y == 3
    assert bin.limit_order_fee_ask_side == 4
    assert bin.limit_order_fee_bid_side == 5
    assert bin.limit_order_ask_side == 1
    assert bin.order_age == 8
    assert bin.reward_per_token_stored == [0, 1]
    assert bin.amount_x_in is None
    assert bin.amount_y_in is None


def test_legacy_bin_keeps_removed_fields_without_fabricating_order_data():
    data = current_bin()
    for field in ["fulfilledOrderAmountX", "fulfilledOrderAmountY", "limitOrderFeeAskSide",
                  "limitOrderFeeBidSide", "openOrderAmount", "totalProcessingOrderAmount",
                  "processedOrderRemainingAmount", "orderAge", "limitOrderAskSide"]:
        del data[field]
    data.update(amountXIn="0a", amountYIn="0b")
    bin = Bin(data)
    assert bin.amount_x_in == 10
    assert bin.amount_y_in == 11
    assert bin.open_order_amount is None
    assert bin.processed_order_remaining_amount is None
    assert bin.limit_order_ask_side is None


def test_zero_order_fields_are_distinct_from_missing_fields():
    data = current_bin()
    data.update(openOrderAmount="00", processedOrderRemainingAmount="00", limitOrderAskSide=0)
    bin = Bin(data)
    assert bin.open_order_amount == 0
    assert bin.processed_order_remaining_amount == 0
    assert bin.limit_order_ask_side == 0
