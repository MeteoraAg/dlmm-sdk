import pytest
from datetime import datetime, timedelta
from market_making.analytics.data_collection import (
    MarketDataCollector,
    VolatilityCalculator,
    OrderFlowAnalyzer,
)
from market_making.types import Quote, Trade
from market_making.errors import StaleDataError, InsufficientDataError, DataQualityError


class TestMarketDataValidation:
    @pytest.fixture
    def market_data_collector(self):
        return MarketDataCollector(
            stale_threshold=timedelta(minutes=1),
            min_quotes_required=10,
            max_quote_gap=timedelta(seconds=30),
        )

    def test_stale_quote_handling(self, market_data_collector):
        """Test handling of stale quotes with various scenarios"""
        now = datetime.now()
        quotes = [
            Quote(timestamp=now - timedelta(minutes=2), bid=100, ask=101),  # Stale
            Quote(timestamp=now, bid=100, ask=101),  # Fresh
            Quote(
                timestamp=now - timedelta(seconds=45), bid=100, ask=101
            ),  # Borderline
        ]

        with pytest.warns(UserWarning, match="Stale quotes detected"):
            report = market_data_collector.validate_quotes(quotes)

        assert report.stale_quote_count == 1
        assert report.usable_quote_count == 2

        # Test complete quote outage
        stale_quotes = [
            Quote(timestamp=now - timedelta(minutes=5), bid=100, ask=101)
            for _ in range(5)
        ]

        with pytest.raises(StaleDataError, match="All quotes are stale"):
            market_data_collector.validate_quotes(stale_quotes)

    def test_quote_gap_handling(self, market_data_collector):
        """Test handling of gaps in quote data"""
        now = datetime.now()
        quotes = [
            Quote(timestamp=now - timedelta(seconds=i * 15), bid=100 + i, ask=101 + i)
            for i in range(10)
        ]
        # Insert gap
        gap_start = now - timedelta(seconds=75)
        gap_end = now - timedelta(seconds=45)

        quotes_with_gap = [
            q for q in quotes if q.timestamp < gap_start or q.timestamp > gap_end
        ]

        interpolated = market_data_collector.handle_quote_gaps(quotes_with_gap)

        # Verify interpolation
        gap_quotes = [q for q in interpolated if gap_start < q.timestamp < gap_end]
        assert len(gap_quotes) > 0
        assert all(100 <= q.bid <= 105 for q in gap_quotes)  # Reasonable interpolation


class TestVolatilityValidation:
    @pytest.fixture
    def volatility_calculator(self):
        return VolatilityCalculator(
            windows=[timedelta(minutes=1), timedelta(minutes=5)],
            min_samples=10,
            max_gap_ratio=0.2,
        )

    def test_rolling_window_edge_cases(self, volatility_calculator):
        """Test volatility calculation edge cases"""
        # Test insufficient samples
        sparse_prices = [100 + i for i in range(5)]
        with pytest.raises(InsufficientDataError):
            volatility_calculator.calculate(sparse_prices, window=timedelta(minutes=1))

        # Test large gaps
        prices_with_gaps = [100 + i for i in range(20)]
        prices_with_gaps[10:15] = [None] * 5  # 25% gap

        with pytest.raises(DataQualityError, match="Too many gaps"):
            volatility_calculator.calculate(
                prices_with_gaps, window=timedelta(minutes=5)
            )

        # Test extreme volatility
        jumping_prices = [100 + ((-1) ** i * i * 10) for i in range(20)]
        vol = volatility_calculator.calculate(
            jumping_prices, window=timedelta(minutes=5)
        )
        assert vol > 0  # Should handle high volatility without breaking


class TestOrderFlowValidation:
    @pytest.fixture
    def order_flow_analyzer(self):
        return OrderFlowAnalyzer(
            min_trade_size=0.01, max_trade_size=100.0, window_size=timedelta(minutes=5)
        )

    def test_fill_handling_edge_cases(self, order_flow_analyzer):
        """Test order flow analysis with various fill scenarios"""
        now = datetime.now()

        # Test no fills
        empty_period = order_flow_analyzer.calculate_imbalance([], now)
        assert empty_period == 0  # No imbalance with no trades

        # Test partial fills
        partial_fills = [
            Trade(timestamp=now, price=100, size=0.5, is_buyer=True),
            Trade(timestamp=now, price=100, size=0.3, is_buyer=True),
            Trade(timestamp=now, price=100, size=0.2, is_buyer=False),
        ]

        imbalance = order_flow_analyzer.calculate_imbalance(partial_fills, now)
        assert 0 < imbalance <= 1  # Should show buyer dominance

        # Test extreme sizes
        extreme_fills = [
            Trade(timestamp=now, price=100, size=0.001, is_buyer=True),  # Too small
            Trade(timestamp=now, price=100, size=1000, is_buyer=True),  # Too large
            Trade(timestamp=now, price=100, size=1.0, is_buyer=True),  # Normal
        ]

        filtered_fills = order_flow_analyzer.filter_trades(extreme_fills)
        assert len(filtered_fills) == 1  # Only normal trade remains

    def test_fill_aggregation(self, order_flow_analyzer):
        """Test trade aggregation with complex scenarios"""
        now = datetime.now()
        trades = [
            # Micro trades
            Trade(timestamp=now, price=100, size=0.02, is_buyer=True),
            Trade(timestamp=now, price=100, size=0.02, is_buyer=True),
            # Normal trade
            Trade(timestamp=now, price=100, size=1.0, is_buyer=False),
            # Large trade
            Trade(timestamp=now, price=100, size=50.0, is_buyer=True),
        ]

        aggregated = order_flow_analyzer.aggregate_trades(trades)

        assert len(aggregated) == 3  # Micro trades combined
        assert aggregated[0].size == 0.04  # Micro trades summed
        assert any(t.size == 50.0 for t in aggregated)  # Large trade preserved
