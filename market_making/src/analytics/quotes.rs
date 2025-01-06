

use anchor_lang::prelude::*;
use std::collections::VecDeque;
use std::time::{SystemTime, UNIX_EPOCH};

const QUOTE_HISTORY_SIZE: usize = 300; // 5 minutes at 1s intervals

pub struct QuoteHistory {
    pub pair: Pubkey,
    pub quotes: VecDeque<Quote>,
}

#[derive(Clone, Debug)]
pub struct Quote {
    pub timestamp: u64,
    pub bid: f64,
    pub ask: f64,
    pub spread: f64,
    pub mid_price: f64,
}

impl QuoteHistory {
    pub fn new(pair: Pubkey) -> Self {
        Self {
            pair,
            quotes: VecDeque::with_capacity(QUOTE_HISTORY_SIZE),
        }
    }

    pub fn add_quote(&mut self, bid: f64, ask: f64) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
            
        let quote = Quote {
            timestamp,
            bid,
            ask,
            spread: ask - bid,
            mid_price: (ask + bid) / 2.0,
        };

        if self.quotes.len() >= QUOTE_HISTORY_SIZE {
            self.quotes.pop_front();
        }
        self.quotes.push_back(quote);
    }

    pub fn get_current_spread(&self) -> Option<f64> {
        self.quotes.back().map(|q| q.spread)
    }

    pub fn get_average_spread(&self, window: usize) -> Option<f64> {
        if self.quotes.is_empty() {
            return None;
        }
        let window = std::cmp::min(window, self.quotes.len());
        let sum: f64 = self.quotes
            .iter()
            .rev()
            .take(window)
            .map(|q| q.spread)
            .sum();
        Some(sum / window as f64)
    }

    pub fn get_mid_price(&self) -> Option<f64> {
        self.quotes.back().map(|q| q.mid_price)
    }

    pub fn get_price_range(&self, window: usize) -> Option<(f64, f64)> {
        if self.quotes.is_empty() {
            return None;
        }
        let window = std::cmp::min(window, self.quotes.len());
        let prices: Vec<f64> = self.quotes
            .iter()
            .rev()
            .take(window)
            .map(|q| q.mid_price)
            .collect();
            
        Some((
            *prices.iter().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap(),
            *prices.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap()
        ))
    }
}

use super::*;
use crate::analytics::test_utils::MockDataGenerator;
use anchor_lang::prelude::Pubkey;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_history_with_mock_data() {
        let pair = Pubkey::new_unique();
        let mut quote_history = QuoteHistory::new(pair);
        
        let generator = MockDataGenerator::new(100.0, 0.01, 0.1, 0.02);
        let mock_quotes = generator.generate_quote_series(100);
        
        // Add mock quotes
        for (_, bid, ask) in mock_quotes {
            quote_history.add_quote(bid, ask);
        }
        
        // Test spread calculations
        let current_spread = quote_history.get_current_spread();
        assert!(current_spread.is_some());
        
        let avg_spread = quote_history.get_average_spread(50);
        assert!(avg_spread.is_some());
        
        // Test price range
        let (min, max) = quote_history.get_price_range(50).unwrap();
        assert!(min < max);
    }

    #[test]
    fn test_quote_history_capacity() {
        let pair = Pubkey::new_unique();
        let mut quote_history = QuoteHistory::new(pair);
        
        let generator = MockDataGenerator::new(100.0, 0.01, 0.1, 0.02);
        let mock_quotes = generator.generate_quote_series(QUOTE_HISTORY_SIZE + 50);
        
        // Add more quotes than capacity
        for (_, bid, ask) in mock_quotes {
            quote_history.add_quote(bid, ask);
        }
        
        // Verify capacity is maintained
        assert_eq!(quote_history.quotes.len(), QUOTE_HISTORY_SIZE);
    }
}