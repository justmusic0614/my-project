// Yahoo Finance Data Source Adapter
const DataSourceAdapter = require('./adapter');
const fetch = require('node-fetch');

class YahooFinanceAdapter extends DataSourceAdapter {
  constructor(config) {
    super('Yahoo Finance', config);
    this.baseUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/';
  }

  async fetchMarketData(symbol) {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}${symbol}?interval=1d&range=5d`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status}`);
      }

      const json = await response.json();
      
      // SRE: 數據驗證層
      if (!json || !json.chart || !json.chart.result || json.chart.result.length === 0) {
        throw new Error(`Yahoo Finance API returned invalid data structure for ${symbol}`);
      }
      
      const result = json.chart.result[0];
      
      if (!result.meta) {
        throw new Error(`Missing meta data for ${symbol}`);
      }
      
      if (!result.indicators || !result.indicators.quote || result.indicators.quote.length === 0) {
        throw new Error(`Missing quote data for ${symbol}`);
      }
      
      const meta = result.meta;
      const quote = result.indicators.quote[0];
      
      // 驗證必要欄位
      if (!quote.close || quote.close.length === 0) {
        throw new Error(`Missing close prices for ${symbol}`);
      }
      
      const latestIndex = quote.close.length - 1;
      const close = quote.close[latestIndex];
      const open = quote.open[latestIndex];
      const volume = quote.volume[latestIndex];
      const prevClose = meta.chartPreviousClose;
      
      // 驗證數值有效性
      if (close === null || close === undefined || isNaN(close)) {
        throw new Error(`Invalid close price for ${symbol}: ${close}`);
      }
      
      if (prevClose === null || prevClose === undefined || isNaN(prevClose)) {
        throw new Error(`Invalid previous close for ${symbol}: ${prevClose}`);
      }
      
      const change = close - prevClose;
      const changePct = (change / prevClose) * 100;

      const data = {
        symbol: symbol,
        close: close,
        open: open,
        high: quote.high[latestIndex],
        low: quote.low[latestIndex],
        volume: volume,
        change: change,
        changePct: changePct,
        currency: meta.currency,
        timestamp: new Date(meta.regularMarketTime * 1000).toISOString()
      };

      return {
        data: data,
        metadata: {
          source: this.name,
          timestamp: data.timestamp,
          confidence: this.assessConfidence(data, { timestamp: data.timestamp })
        }
      };
    });
  }

  async fetchTechnicalIndicators(symbol, config) {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}${symbol}?interval=1d&range=30d`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status}`);
      }

      const json = await response.json();
      
      // SRE: 數據驗證層
      if (!json || !json.chart || !json.chart.result || json.chart.result.length === 0) {
        throw new Error(`Yahoo Finance API returned invalid data structure for ${symbol}`);
      }
      
      const result = json.chart.result[0];
      
      if (!result.indicators || !result.indicators.quote || result.indicators.quote.length === 0) {
        throw new Error(`Missing quote data for ${symbol}`);
      }
      
      const quote = result.indicators.quote[0];
      
      if (!quote.close || quote.close.length === 0) {
        throw new Error(`Missing close prices for ${symbol}`);
      }
      
      const closes = quote.close.filter(c => c !== null && !isNaN(c));
      
      // 驗證有足夠的數據計算指標
      if (closes.length < 20) {
        throw new Error(`Insufficient data for technical indicators (${closes.length} < 20)`);
      }

      // 計算移動平均線
      const ma5 = this.calculateMA(closes, 5);
      const ma20 = this.calculateMA(closes, 20);
      
      // 計算 RSI
      const rsi = this.calculateRSI(closes, config.rsi_period || 14);

      const data = {
        ma5: ma5,
        ma20: ma20,
        rsi: rsi
      };

      return {
        data: data,
        metadata: {
          source: this.name,
          timestamp: new Date().toISOString(),
          confidence: 'HIGH'
        }
      };
    });
  }

  calculateMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return parseFloat((sum / period).toFixed(2));
  }

  calculateRSI(prices, period) {
    if (prices.length < period + 1) return null;
    
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const recentChanges = changes.slice(-period);
    const gains = recentChanges.filter(c => c > 0);
    const losses = recentChanges.filter(c => c < 0).map(Math.abs);

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return parseFloat(rsi.toFixed(2));
  }

  async fetchNews() {
    // Yahoo Finance RSS 較不穩定，保留介面供未來擴充
    throw new Error('Yahoo Finance news feed not implemented yet');
  }
}

module.exports = YahooFinanceAdapter;
