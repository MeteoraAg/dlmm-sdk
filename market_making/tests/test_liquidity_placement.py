import pytest
from market_making.strategy.liquidity_placement import BinManager
from market_making.types import BinRange, VolatilityMetrics


class TestBinManagement:
    @pytest.fixture
    def bin_manager(self):
        return BinManager(
            min_bin_width=0.001, max_bin_width=0.1, volatility_multiplier=2.0
        )

    def test_dynamic_bin_adjustment(self, bin_manager):
        """Test bin width adjustments based on volatility"""
        low_vol = VolatilityMetrics(current=0.05, moving_avg=0.04, forecast=0.05)

        high_vol = VolatilityMetrics(current=0.2, moving_avg=0.15, forecast=0.25)

        low_vol_bins = bin_manager.calculate_bin_range(
            mid_price=100.0, volatility=low_vol, predicted_spread=0.01
        )

        high_vol_bins = bin_manager.calculate_bin_range(
            mid_price=100.0, volatility=high_vol, predicted_spread=0.01
        )

        assert high_vol_bins.width > low_vol_bins.width
        assert high_vol_bins.bin_count > low_vol_bins.bin_count

    def test_exit_conditions(self, bin_manager):
        """Test position exit triggers"""
        position = BinRange(center_price=100.0, width=0.05, bin_count=10)

        # Test price deviation exit
        assert bin_manager.should_exit(
            position=position,
            current_price=105.0,
            realized_spread=0.01,
            target_spread=0.01,
        )

        # Test spread compression exit
        assert bin_manager.should_exit(
            position=position,
            current_price=100.0,
            realized_spread=0.005,
            target_spread=0.01,
        )
