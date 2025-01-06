import pytest
from datetime import timedelta
from market_making.strategy.market_maker import MarketMaker
from market_making.types import TradingConfig


class TestEndToEnd:
    @pytest.fixture
    def market_maker(self):
        return MarketMaker(
            config=TradingConfig(
                update_interval=timedelta(seconds=30),
                max_positions=3,
                min_profit_threshold=0.001,
            )
        )

    def test_happy_path(self, market_maker, mocker):
        """Test complete trading cycle - happy path"""
        # Mock market data
        mock_market = self._create_mock_market(mocker)

        # Execute trading cycle
        market_maker.update(mock_market)

        # Verify position entry
        assert len(market_maker.active_positions) > 0

        # Simulate profitable conditions
        self._simulate_profitable_trading(mock_market)
        market_maker.update(mock_market)

        # Verify fee collection
        assert market_maker.collected_fees > 0

    def test_position_rotation(self, market_maker, mocker):
        """Test position rotation under changing conditions"""
        mock_market = self._create_mock_market(mocker)

        # Start with one pair
        market_maker.update(mock_market)
        initial_positions = market_maker.active_positions.copy()

        # Simulate better opportunity in different pair
        self._simulate_better_opportunity(mock_market)
        market_maker.update(mock_market)

        # Verify position rotation
        assert market_maker.active_positions != initial_positions

    @staticmethod
    def _create_mock_market(mocker):
        # Create mock market data
        return mocker.Mock(
            quotes={}, trades=[], volatility=0.1, order_flow_imbalance=0.0
        )

    @staticmethod
    def _simulate_profitable_trading(mock_market):
        # Simulate profitable trading conditions
        mock_market.volatility = 0.08
        mock_market.order_flow_imbalance = 0.2

    @staticmethod
    def _simulate_better_opportunity(mock_market):
        # Simulate emergence of better trading opportunity
        mock_market.new_pair_spread = 0.02
        mock_market.new_pair_volatility = 0.05
