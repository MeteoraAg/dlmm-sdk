import pytest
from unittest.mock import Mock, patch
from dlmm.dlmm import DLMM, DLMM_CLIENT
from market_making.analytics.volatility import calculate_realized_volatility
from market_making.analytics.spread import predict_spread
from market_making.analytics.order_flow import calculate_order_imbalance
from market_making.analytics.profit import calculate_expected_profit
from market_making.strategy.position_manager import PositionManager
from solders.pubkey import Pubkey


class MockDLMM:
    def __init__(self):
        self.active_bin = Mock(bin_id=100, price=20.0)
        self.fee_info = Mock(base_fee_rate_percentage=0.1)
        self.token_X = Mock(decimal=9)
        self.token_Y = Mock(decimal=6)

    def get_active_bin(self):
        return self.active_bin

    def get_fee_info(self):
        return self.fee_info

    def get_bins_around_active_bin(self, left, right):
        return {
            "bins": [
                {
                    "bin_id": i,
                    "price": 20.0 + (i - 100) * 0.1,
                    "x_amount": 1000,
                    "y_amount": 1000,
                }
                for i in range(100 - left, 100 + right + 1)
            ]
        }


@pytest.fixture
def mock_dlmm():
    return MockDLMM()


def test_basic_market_making_workflow(mock_dlmm):
    # 1. Fetch market data
    active_bin = mock_dlmm.get_active_bin()
    current_price = active_bin.price

    # 2. Calculate analytics
    mock_prices = [20.0 + i * 0.1 for i in range(-10, 11)]
    volatility = calculate_realized_volatility(mock_prices, window=5)

    mock_spreads = [0.1 + i * 0.01 for i in range(10)]
    predicted_spread = predict_spread(
        historical_spreads=mock_spreads, volatility=volatility, order_imbalance=0.2
    )

    # 3. Position sizing
    bins_data = mock_dlmm.get_bins_around_active_bin(5, 5)

    expected_profit = calculate_expected_profit(
        predicted_spread=predicted_spread,
        volatility=volatility,
        current_price=current_price,
        slippage=0.001,
        size=1000,
    )

    # 4. Validate strategy logic
    assert volatility > 0
    assert predicted_spread > 0
    assert expected_profit > 0
