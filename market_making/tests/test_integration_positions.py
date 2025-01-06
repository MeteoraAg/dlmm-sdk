from market_making.strategy.position_manager import PositionManager


def test_position_lifecycle(mock_dlmm):
    # Setup position manager
    position_manager = PositionManager(
        dlmm=mock_dlmm, min_profit_threshold=0.001, max_positions=3
    )

    # Test position entry logic
    entry_decision = position_manager.evaluate_entry(
        predicted_spread=0.02,
        volatility=0.15,
        current_price=20.0,
        expected_profit=0.005,
    )

    assert entry_decision.should_enter
    assert len(entry_decision.suggested_bins) > 0

    # Test position monitoring
    position_status = position_manager.monitor_position(
        position_id=1, current_price=20.1, realized_spread=0.018, target_spread=0.02
    )

    assert position_status.is_healthy
    assert not position_status.should_exit

    # Test exit conditions
    exit_status = position_manager.evaluate_exit(
        position_id=1,
        current_price=21.0,  # Price moved out of range
        realized_spread=0.01,  # Spread compressed
    )

    assert exit_status.should_exit
    assert exit_status.reason == "price_out_of_range"
