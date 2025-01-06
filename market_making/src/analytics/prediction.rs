

use std::collections::VecDeque;

pub struct PricePrediction {
    pub history: VecDeque<(u64, f64)>, // (timestamp, price)
    pub window_size: usize,
}

impl PricePrediction {
    pub fn new(window_size: usize) -> Self {
        Self {
            history: VecDeque::with_capacity(window_size),
            window_size,
        }
    }

    pub fn add_price(&mut self, timestamp: u64, price: f64) {
        if self.history.len() >= self.window_size {
            self.history.pop_front();
        }
        self.history.push_back((timestamp, price));
    }

    pub fn predict_next_price(&self) -> Option<f64> {
        if self.history.len() < 2 {
            return None;
        }

        // Simple moving average prediction
        let sum: f64 = self.history.iter().map(|(_, price)| price).sum();
        Some(sum / self.history.len() as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_price_prediction() {
        let mut predictor = PricePrediction::new(5);
        
        predictor.add_price(1, 100.0);
        predictor.add_price(2, 101.0);
        predictor.add_price(3, 102.0);
        
        let prediction = predictor.predict_next_price();
        assert!(prediction.is_some());
        assert!(prediction.unwrap() > 100.0);
    }
}