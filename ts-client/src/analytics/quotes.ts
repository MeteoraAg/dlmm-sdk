

import { PublicKey } from '@solana/web3.js';

export interface Quote {
  timestamp: number;
  bid: number;
  ask: number;
  spread: number;
  midPrice: number;
}

export class QuoteAnalytics {
  private readonly HISTORY_SIZE = 300;
  private quotes: Quote[] = [];
  
  constructor(public pair: PublicKey) {}

  addQuote(bid: number, ask: number): void {
    const quote = {
      timestamp: Date.now(),
      bid,
      ask,
      spread: ask - bid,
      midPrice: (ask + bid) / 2
    };

    if (this.quotes.length >= this.HISTORY_SIZE) {
      this.quotes.shift();
    }
    this.quotes.push(quote);
  }

  getCurrentSpread(): number | null {
    return this.quotes.length > 0 
      ? this.quotes[this.quotes.length - 1].spread
      : null;
  }

  getAverageSpread(window: number): number | null {
    if (this.quotes.length === 0) return null;
    
    const windowSize = Math.min(window, this.quotes.length);
    const recentQuotes = this.quotes.slice(-windowSize);
    
    const sum = recentQuotes.reduce((acc, quote) => acc + quote.spread, 0);
    return sum / windowSize;
  }

  getMidPrice(): number | null {
    return this.quotes.length > 0
      ? this.quotes[this.quotes.length - 1].midPrice
      : null;
  }

  getPriceRange(window: number): [number, number] | null {
    if (this.quotes.length === 0) return null;
    
    const windowSize = Math.min(window, this.quotes.length);
    const prices = this.quotes.slice(-windowSize).map(q => q.midPrice);
    
    return [Math.min(...prices), Math.max(...prices)];
  }
}