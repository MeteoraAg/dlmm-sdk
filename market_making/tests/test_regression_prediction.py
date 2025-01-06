import pytest
import numpy as np
from datetime import timedelta
from market_making.analytics.regression import SpreadPredictor


class TestSpreadPrediction:
    @pytest.fixture
    def spread_predictor(self):
        return SpreadPredictor(
            lookback_periods=10, update_frequency=timedelta(seconds=30), min_samples=5
        )

    def test_regime_shifts(self, spread_predictor):
        """Test prediction accuracy during market regime changes"""
        # Simulate calm market
        calm_data = {
            "spreads": [0.01 + np.random.normal(0, 0.001) for _ in range(100)],
            "volatility": [0.05 + np.random.normal(0, 0.005) for _ in range(100)],
            "imbalance": [0.1 + np.random.normal(0, 0.05) for _ in range(100)],
        }

        # Simulate volatile market
        volatile_data = {
            "spreads": [0.05 + np.random.normal(0, 0.01) for _ in range(100)],
            "volatility": [0.2 + np.random.normal(0, 0.02) for _ in range(100)],
            "imbalance": [0.4 + np.random.normal(0, 0.2) for _ in range(100)],
        }

        # Test predictions in each regime
        calm_pred = spread_predictor.predict(calm_data)
        volatile_pred = spread_predictor.predict(volatile_data)

        assert volatile_pred.spread > calm_pred.spread
        assert volatile_pred.confidence < calm_pred.confidence

    def test_high_frequency_updates(self, spread_predictor):
        """Test model stability with frequent updates"""
        initial_data = self._generate_test_data()

        predictions = []
        for _ in range(100):  # Simulate 100 rapid updates
            predictions.append(spread_predictor.predict(initial_data))
            # Slightly modify data
            initial_data = self._update_test_data(initial_data)

        # Check prediction stability
        pred_std = np.std([p.spread for p in predictions])
        assert pred_std < 0.01  # Predictions shouldn't vary wildly

    @staticmethod
    def _generate_test_data():
        return {
            "spreads": [0.01 + np.random.normal(0, 0.001) for _ in range(100)],
            "volatility": [0.05 + np.random.normal(0, 0.005) for _ in range(100)],
            "imbalance": [0.1 + np.random.normal(0, 0.05) for _ in range(100)],
        }

    @staticmethod
    def _update_test_data(data):
        # Add new datapoint and remove oldest
        for key in data:
            data[key] = data[key][1:] + [data[key][-1] + np.random.normal(0, 0.001)]
        return data
