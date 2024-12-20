

use std::collections::VecDeque;
use std::f64;

pub struct VolatilityCalculator {
    price_history: VecDeque<(u64, f64)>, // (timestamp, price)
    window_sizes: Vec<usize>,            // Different window sizes to track (e.g. 1min, 5min)
}

impl VolatilityCalculator {
    pub fn new(window_sizes: Vec<usize>) -> Self {
        let max_size = *window_sizes.iter().max().unwrap_or(&300);
        Self {
            price_history: VecDeque::with_capacity(max_size),
            window_sizes,
        }
    }

    pub fn add_price(&mut self, timestamp: u64, price: f64) {
        if self.price_history.len() >= self.price_history.capacity() {
            self.price_history.pop_front();
        }
        self.price_history.push_back((timestamp, price));
    }

    pub fn calculate_volatilities(&self) -> Vec<(usize, f64)> {
        self.window_sizes
            .iter()
            .map(|&window| {
                let vol = self.calculate_volatility_for_window(window);
                (window, vol)
            })
            .collect()
    }

    fn calculate_volatility_for_window(&self, window: usize) -> f64 {
        if self.price_history.len() < 2 {
            return 0.0;
        }

        let prices: Vec<_> = self.price_history
            .iter()
            .rev()
            .take(window)
            .map(|(_, price)| *price)
            .collect();

        if prices.len() < 2 {
            return 0.0;
        }

        // Calculate log returns
        let returns: Vec<f64> = prices
            .windows(2)
            .map(|w| (w[0] / w[1]).ln())
            .collect();

        // Calculate standard deviation
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let variance = returns
            .iter()
            .map(|r| (r - mean).powi(2))
            .sum::<f64>() / (returns.len() - 1) as f64;

        // Annualize volatility (assuming prices are at 1-second intervals)
        (variance.sqrt() * (31_536_000_f64 / window as f64).sqrt()) * 100.0
    }

    pub fn get_latest_volatility(&self) -> f64 {
        // Use the smallest window size for latest volatility
        if let Some(&window) = self.window_sizes.iter().min() {
            self.calculate_volatility_for_window(window)
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_volatility_calculation() {
        let mut calc = VolatilityCalculator::new(vec![60, 300]); // 1min and 5min windows
        
        // Add some test prices
        for i in 0..400 {
            // Simulate some price movement
            let price = 100.0 + (i as f64 / 100.0).sin() * 5.0;
            calc.add_price(i as u64, price);
        }

        let vols = calc.calculate_volatilities();
        assert_eq!(vols.len(), 2);
        
        // Verify volatilities are reasonable (non-zero and finite)
        for (_, vol) in vols {
            assert!(vol > 0.0);
            assert!(vol.is_finite());
        }
    }
}