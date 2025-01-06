

#[derive(Debug, Clone)]
pub struct ProfitMetrics {
    pub total_profit: f64,
    pub profit_per_trade: f64,
    pub win_rate: f64,
}

pub struct ProfitCalculator {
    trades: Vec<Trade>,
}

#[derive(Debug, Clone)]
pub struct Trade {
    pub timestamp: u64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub amount: f64,
}

impl ProfitCalculator {
    pub fn new() -> Self {
        Self { trades: Vec::new() }
    }

    pub fn add_trade(&mut self, trade: Trade) {
        self.trades.push(trade);
    }

    pub fn calculate_metrics(&self) -> ProfitMetrics {
        let mut total_profit = 0.0;
        let mut winning_trades = 0;

        for trade in &self.trades {
            let profit = (trade.exit_price - trade.entry_price) * trade.amount;
            total_profit += profit;
            if profit > 0.0 {
                winning_trades += 1;
            }
        }

        let profit_per_trade = if !self.trades.is_empty() {
            total_profit / self.trades.len() as f64
        } else {
            0.0
        };

        let win_rate = if !self.trades.is_empty() {
            winning_trades as f64 / self.trades.len() as f64
        } else {
            0.0
        };

        ProfitMetrics {
            total_profit,
            profit_per_trade,
            win_rate,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profit_calculation() {
        let mut calculator = ProfitCalculator::new();
        
        calculator.add_trade(Trade {
            timestamp: 1,
            entry_price: 100.0,
            exit_price: 110.0,
            amount: 1.0,
        });

        let metrics = calculator.calculate_metrics();
        assert_eq!(metrics.total_profit, 10.0);
        assert_eq!(metrics.win_rate, 1.0);
    }
}