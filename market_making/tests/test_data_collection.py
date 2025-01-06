

import pytest
from datetime import datetime, timedelta
import numpy as np
from market_making.analytics.data_collection import (
    QuoteCollector,
    VolatilityCalculator,
    OrderFlowTracker
)

class TestQuoteCollection:
    @pytest.fixture
    def quote_collector(self):
        return QuoteCollector(
            window_size=timedelta(minutes=5),
            sampling_interval=timedelta(seconds=30)
        )
    
    def test_missing_quotes(self, quote_collector):
        """Test handling of missing or delayed quotes"""
        # Simulate some missing quotes
        quotes = [
            (datetime.now() - timedelta(seconds=i*30), 100.0, 101.0)
            for i in range(10) if i != 5  # Missing quote at i=5
        ]
        
        processed_quotes = quote_collector.process_quotes(quotes)
        
        # Should interpolate missing quote
        assert len(processed_quotes) == 10
        assert not np.isnan(processed_quotes[5].price)
        
    def test_stale_quotes(self, quote_collector):
        """Test detection and handling of stale quotes"""
        now = datetime.now()
        stale_quotes = [
            (now - timedelta(minutes=10), 100.0, 101.0),
            (now - timedelta(minutes=9), 100.0, 101.0),
            (now, 105.0, 106.0)
        ]
        
        with pytest.warns(UserWarning, match="Stale quote detected"):
            processed_quotes = quote_collector.process_quotes(stale_quotes)
            
        # Should flag stale quotes
        assert processed_quotes[0].is_stale
        assert not processed_quotes[2].is_stale

class TestVolatilityCalculation:
    @pytest.fixture
    def volatility_calculator(self):
        return VolatilityCalculator(
            windows=[timedelta(minutes=1), timedelta(minutes=5)],
            min_samples=10
        )
    
    def test_insufficient_data(self, volatility_calculator):
        """Test handling of insufficient data points"""
        prices = [100.0 + i for i in range(5)]  # Only 5 samples
        
        with pytest.raises(InsufficientDataError):
            volatility_calculator.calculate(prices)
            
    def test_outlier_handling(self, volatility_calculator):
        """Test handling of price outliers"""
        prices = [100.0 + i for i in range(20)]
        prices[10] = 1000.0  # Outlier
        
        vol_with_outlier = volatility_calculator.calculate(prices)
        
        # Calculate with outlier removed
        prices[10] = 110.0
        vol_without_outlier = volatility_calculator.calculate(prices)
        
        # Outlier should be detected and handled
        assert abs(vol_with_outlier - vol_without_outlier) < 0.1

class TestOrderFlowTracking:
    @pytest.fixture
    def order_flow_tracker(self):
        return OrderFlowTracker(
            window_size=timedelta(minutes=5),
            volume_buckets=10
        )
    
    def test_imbalance_calculation(self, order_flow_tracker):
        """Test order flow imbalance calculation"""
        trades = [
            # timestamp, size, is_buyer_maker
            (datetime.now(), 100, True),
            (datetime.now(), 50, False),
            (datetime.now(), 75, True)
        ]
        
        imbalance = order_flow_tracker.calculate_imbalance(trades)
        
        # More buyer-maker volume should show positive imbalance
        assert imbalance > 0
        assert -1 <= imbalance <= 1  # Normalized
        
    def test_volume_profile(self, order_flow_tracker):
        """Test volume profile construction"""
        trades = [
            (datetime.now(), 100, True, 105.0),
            (datetime.now(), 50, False, 104.0),
            (datetime.now(), 75, True, 106.0)
        ]
        
        profile = order_flow_tracker.construct_volume_profile(trades)
        
        # Check volume distribution
        assert len(profile.price_levels) == 10
        assert profile.total_volume == 225
        assert profile.weighted_average_price ≈ 105.0

import pytest
from datetime import datetime, timedelta
import numpy as np
from typing import List, Tuple
from market_making.analytics.data_collection import (
    QuoteCollector, 
    VolatilityCalculator,
    OrderFlowTracker,
    TradeHistoryCollector,
    MarketDepthCollector,
    DataQualityChecker,
    TimeSeriesNormalizer
)
from market_making.types import Quote, Trade, OrderBook, DataQualityReport
from market_making.errors import (
    InsufficientDataError,
    StaleDataError, 
    DataQualityError,
    TimeSeriesError
)

class TestQuoteCollection:
    @pytest.fixture
    def quote_collector(self):
        return QuoteCollector(
            window_size=timedelta(minutes=5),
            sampling_interval=timedelta(seconds=30),
            max_gap_fill=timedelta(minutes=1)
        )

    def test_basic_quote_collection(self, quote_collector):
        """Test normal quote collection and processing"""
        quotes = self._generate_test_quotes(count=100, interval_seconds=30)
        processed = quote_collector.process_quotes(quotes)
        
        assert len(processed) == 100
        assert all(hasattr(q, 'timestamp') for q in processed)
        assert all(hasattr(q, 'bid') for q in processed)
        assert all(hasattr(q, 'ask') for q in processed)
        
    def test_quote_deduplication(self, quote_collector):
        """Test handling of duplicate quotes"""
        now = datetime.now()
        duplicates = [
            (now, 100.0, 101.0),
            (now, 100.0, 101.0),
            (now + timedelta(seconds=1), 100.0, 101.0)
        ]
        
        processed = quote_collector.process_quotes(duplicates)
        assert len(processed) == 2  # Should deduplicate
        
    def test_quote_validation(self, quote_collector):
        """Test quote validation rules"""
        invalid_quotes = [
            (datetime.now(), -100.0, 101.0),  # Negative price
            (datetime.now(), 100.0, 99.0),    # Crossed market
            (datetime.now(), np.inf, 101.0),  # Invalid price
        ]
        
        for quote in invalid_quotes:
            with pytest.raises(DataQualityError):
                quote_collector.validate_quote(quote)

    def test_gap_filling_strategies(self, quote_collector):
        """Test different gap filling strategies"""
        quotes = self._generate_test_quotes(count=10, interval_seconds=30)
        # Create gaps
        del quotes[3:6]
        
        # Test linear interpolation
        filled_linear = quote_collector.fill_gaps(quotes, method='linear')
        assert len(filled_linear) == 10
        
        # Test forward fill
        filled_ffill = quote_collector.fill_gaps(quotes, method='ffill')
        assert len(filled_ffill) == 10
        
        # Test maximum gap size
        large_gap_quotes = quotes.copy()
        del large_gap_quotes[2:8]
        with pytest.raises(DataQualityError, match="Gap too large"):
            quote_collector.fill_gaps(large_gap_quotes)

    @staticmethod
    def _generate_test_quotes(count: int, interval_seconds: int) -> List[Quote]:
        base_time = datetime.now()
        return [
            Quote(
                timestamp=base_time + timedelta(seconds=i*interval_seconds),
                bid=100.0 + np.sin(i/10),
                ask=101.0 + np.sin(i/10)
            ) for i in range(count)
        ]

class TestTradeHistoryCollection:
    @pytest.fixture
    def trade_collector(self):
        return TradeHistoryCollector(
            max_history=timedelta(hours=24),
            min_trade_size=0.01
        )
    
    def test_trade_filtering(self, trade_collector):
        """Test trade filtering by size and timestamp"""
        trades = [
            Trade(timestamp=datetime.now(), price=100.0, size=0.001),  # Too small
            Trade(timestamp=datetime.now(), price=100.0, size=1.0),    # Valid
            Trade(timestamp=datetime.now()-timedelta(days=2), price=100.0, size=1.0)  # Too old
        ]
        
        filtered = trade_collector.filter_trades(trades)
        assert len(filtered) == 1
        
    def test_trade_aggregation(self, trade_collector):
        """Test trade aggregation by time windows"""
        trades = self._generate_test_trades(count=100)
        
        # Test different aggregation windows
        for window in [timedelta(minutes=1), timedelta(minutes=5)]:
            aggregated = trade_collector.aggregate_trades(trades, window)
            assert all(hasattr(t, 'vwap') for t in aggregated)
            assert all(hasattr(t, 'volume') for t in aggregated)

    def test_trade_classification(self, trade_collector):
        """Test trade aggressor classification"""
        trades = [
            Trade(price=100.0, size=1.0, bid_price=99.0, ask_price=101.0),
            Trade(price=101.0, size=1.0, bid_price=99.0, ask_price=101.0)
        ]
        
        classified = trade_collector.classify_trades(trades)
        assert classified[0].aggressor == 'buyer'
        assert classified[1].aggressor == 'seller'

class TestMarketDepthCollection:
    @pytest.fixture
    def depth_collector(self):
        return MarketDepthCollector(
            levels=10,
            min_size_filter=0.1
        )
    
    def test_order_book_construction(self, depth_collector):
        """Test order book construction and validation"""
        book = self._generate_test_orderbook()
        
        assert depth_collector.validate_book(book)
        assert len(depth_collector.get_bids(book)) == 10
        assert len(depth_collector.get_asks(book)) == 10
        
    def test_depth_imbalance(self, depth_collector):
        """Test depth imbalance calculations"""
        book = self._generate_test_orderbook()
        
        imbalance = depth_collector.calculate_depth_imbalance(book)
        assert -1 <= imbalance <= 1
        
    def test_book_updates(self, depth_collector):
        """Test incremental book updates"""
        book = self._generate_test_orderbook()
        updates = [
            ('add', 'bid', 100.0, 1.0),
            ('remove', 'ask', 101.0, 1.0)
        ]
        
        updated_book = depth_collector.apply_updates(book, updates)
        assert depth_collector.validate_book(updated_book)

class TestDataQualityChecking:
    @pytest.fixture
    def quality_checker(self):
        return DataQualityChecker(
            max_spread_ratio=0.05,
            max_price_change=0.10,
            min_quote_count=10
        )
    
    def test_spread_quality(self, quality_checker):
        """Test spread reasonableness checks"""
        quotes = [
            Quote(bid=100.0, ask=101.0),  # 1% spread - ok
            Quote(bid=100.0, ask=110.0)   # 10% spread - suspicious
        ]
        
        report = quality_checker.check_spreads(quotes)
        assert not report.has_suspicious_spreads[0]
        assert report.has_suspicious_spreads[1]
        
    def test_price_continuity(self, quality_checker):
        """Test price continuity and jump detection"""
        prices = [100.0 + i*0.1 for i in range(10)]
        prices[5] = 200.0  # Suspicious jump
        
        jumps = quality_checker.detect_price_jumps(prices)
        assert len(jumps) == 1
        assert jumps[0] == 5

class TestTimeSeriesProcessing:
    @pytest.fixture
    def ts_processor(self):
        return TimeSeriesNormalizer(
            window_size=100,
            scaling_method='standard'
        )
    
    def test_normalization(self, ts_processor):
        """Test time series normalization"""
        data = np.random.normal(100, 10, 1000)
        normalized = ts_processor.normalize(data)
        
        assert abs(normalized.mean()) < 0.01
        assert abs(normalized.std() - 1.0) < 0.01
        
    def test_outlier_detection(self, ts_processor):
        """Test outlier detection in time series"""
        data = np.random.normal(100, 10, 1000)
        data[500] = 1000.0  # Outlier
        
        outliers = ts_processor.detect_outliers(data)
        assert 500 in outliers

    def test_seasonality(self, ts_processor):
        """Test seasonality detection"""
        # Generate data with known seasonality
        t = np.linspace(0, 100, 1000)
        seasonal_data = 100 + 10*np.sin(2*np.pi*t/24)  # 24-period seasonality
        
        period = ts_processor.detect_seasonality(seasonal_data)
        assert abs(period - 24) < 1.0