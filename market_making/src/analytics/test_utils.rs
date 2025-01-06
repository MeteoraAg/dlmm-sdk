

use std::time::{SystemTime, UNIX_EPOCH};
use rand::Rng;
use rand_distr::{Normal, Distribution};

pub struct MockDataGenerator {
    pub base_price: f64,
    pub volatility: f64,
    pub spread_mean: f64,
    pub spread_std: f64,
}

impl MockDataGenerator {
    pub fn new(base_price: f64, volatility: f64, spread_mean: f64, spread_std: f64) -> Self {
        Self {
            base_price,
            volatility,
            spread_mean,
            spread_std,
        }
    }

    pub fn generate_price_series(&self, n_points: usize) -> Vec<(u64, f64)> {
        let mut rng = rand::thread_rng();
        let normal = Normal::new(0.0, self.volatility).unwrap();
        
        let mut prices = Vec::with_capacity(n_points);
        let mut current_price = self.base_price;
        let start_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        for i in 0..n_points {
            let return_shock = normal.sample(&mut rng);
            current_price *= (1.0 + return_shock);
            prices.push((start_time + i as u64, current_price));
        }

        prices
    }

    pub fn generate_quote_series(&self, n_points: usize) -> Vec<(u64, f64, f64)> {
        let mut rng = rand::thread_rng();
        let price_normal = Normal::new(0.0, self.volatility).unwrap();
        let spread_normal = Normal::new(self.spread_mean, self.spread_std).unwrap();
        
        let mut quotes = Vec::with_capacity(n_points);
        let mut current_price = self.base_price;
        let start_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        for i in 0..n_points {
            let return_shock = price_normal.sample(&mut rng);
            current_price *= (1.0 + return_shock);
            let spread = spread_normal.sample(&mut rng).abs();
            
            let bid = current_price - spread/2.0;
            let ask = current_price + spread/2.0;
            
            quotes.push((start_time + i as u64, bid, ask));
        }

        quotes
    }

    pub fn generate_trades(&self, n_trades: usize) -> Vec<(u64, f64, f64, bool)> {
        let mut rng = rand::thread_rng();
        let price_normal = Normal::new(0.0, self.volatility).unwrap();
        let size_normal = Normal::new(1.0, 0.5).unwrap();
        
        let mut trades = Vec::with_capacity(n_trades);
        let mut current_price = self.base_price;
        let start_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        for i in 0..n_trades {
            let return_shock = price_normal.sample(&mut rng);
            current_price *= (1.0 + return_shock);
            let size = (size_normal.sample(&mut rng) as f64).abs();
            let is_buy = rng.gen_bool(0.5);
            
            trades.push((start_time + i as u64, current_price, size, is_buy));
        }

        trades
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_data_generation() {
        let generator = MockDataGenerator::new(100.0, 0.01, 0.1, 0.02);
        
        let prices = generator.generate_price_series(100);
        assert_eq!(prices.len(), 100);
        
        let quotes = generator.generate_quote_series(100);
        assert_eq!(quotes.len(), 100);
        
        let trades = generator.generate_trades(100);
        assert_eq!(trades.len(), 100);
    }
}