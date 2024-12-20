

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