import pytest
from market_making.analytics.profit import ProfitCalculator


class TestProfitCalculation:
    @pytest.fixture
    def profit_calculator(self):
        return ProfitCalculator(slippage_model="linear", inventory_risk_factor=0.1)

    def test_profit_boundary_conditions(self, profit_calculator):
        """Test profit calculation under boundary conditions"""
        # Test zero slippage case
        zero_slippage = profit_calculator.calculate_expected_profit(
            predicted_spread=0.01, size=1000, slippage=0, inventory_risk=0.1
        )

        # Test zero inventory risk case
        zero_inv_risk = profit_calculator.calculate_expected_profit(
            predicted_spread=0.01, size=1000, slippage=0.001, inventory_risk=0
        )

        assert zero_slippage.profit > zero_inv_risk.profit

    def test_concurrent_ranking(self, profit_calculator):
        """Test ranking with tied profit expectations"""
        pairs = [
            {"name": "A", "predicted_spread": 0.01, "size": 1000},
            {"name": "B", "predicted_spread": 0.01, "size": 1000},
            {"name": "C", "predicted_spread": 0.009, "size": 1000},
        ]

        ranked = profit_calculator.rank_pairs(pairs)

        # Check tiebreaking logic
        assert len(ranked) == len(pairs)
        assert ranked[0].profit == ranked[1].profit
        assert ranked[0].profit > ranked[2].profit
