

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