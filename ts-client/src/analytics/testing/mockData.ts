

export class MockDataGenerator {
  constructor(
    private basePrice: number,
    private volatility: number,
    private spreadMean: number,
    private spreadStd: number
  ) {}

  private normalRandom(mean: number, std: number): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std + mean;
  }

  generatePriceSeries(nPoints: number): Array<[number, number]> {
    const prices: Array<[number, number]> = [];
    let currentPrice = this.basePrice;
    const startTime = Date.now();

    for (let i = 0; i < nPoints; i++) {
      const returnShock = this.normalRandom(0, this.volatility);
      currentPrice *= (1.0 + returnShock);
      prices.push([startTime + i * 1000, currentPrice]);
    }

    return prices;
  }

  generateQuotes(nPoints: number): Array<[number, number, number]> {
    const quotes: Array<[number, number, number]> = [];
    let currentPrice = this.basePrice;
    const startTime = Date.now();

    for (let i = 0; i < nPoints; i++) {
      const returnShock = this.normalRandom(0, this.volatility);
      currentPrice *= (1.0 + returnShock);
      const spread = Math.abs(this.normalRandom(this.spreadMean, this.spreadStd));
      
      const bid = currentPrice - spread/2.0;
      const ask = currentPrice + spread/2.0;
      
      quotes.push([startTime + i * 1000, bid, ask]);
    }

    return quotes;
  }

  generateTrades(nTrades: number): Array<[number, number, number, boolean]> {
    const trades: Array<[number, number, number, boolean]> = [];
    let currentPrice = this.basePrice;
    const startTime = Date.now();

    for (let i = 0; i < nTrades; i++) {
      const returnShock = this.normalRandom(0, this.volatility);
      currentPrice *= (1.0 + returnShock);
      const size = Math.abs(this.normalRandom(1.0, 0.5));
      const isBuy = Math.random() > 0.5;
      
      trades.push([startTime + i * 1000, currentPrice, size, isBuy]);
    }

    return trades;
  }
}