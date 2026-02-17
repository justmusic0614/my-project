// FMP Plugin — 美股 Market Enrich
// Financial Modeling Prep API（免費版 250 req/day）
// 批次設計：每次 run 只用 1-3 calls

const https = require('https');
const path = require('path');
const DataSourceAdapter = require('../../adapter');
const CacheManager = require('../../../../shared/cache-manager');
const rateLimiter = require('../../../../shared/rate-limiter');
const costLedger = require('../../../cost-ledger');
const { createLogger } = require('../../../../shared/logger');

const logger = createLogger('fmp-plugin');

class FMPPlugin extends DataSourceAdapter {
  constructor(config = {}) {
    super('FMP', config);
    this.apiKey = process.env.FMP_API_KEY;
    this.baseUrl = config.baseUrl || 'https://financialmodelingprep.com/api';
    this.watchlist = config.watchlist || [
      'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META',
      'AVGO', 'TSM', 'AMD', 'BRK-B', 'BAC', 'OXY', 'CVX', 'KO',
      'QQQ', 'SPY'
    ];
    this.cache = new CacheManager(
      path.join(__dirname, '../../../../data/financial-cache'),
      { logger }
    );
    this.cacheTtl = config.cacheTtl || 1800000; // 30 分鐘
  }

  /**
   * Plugin 統一介面：fetch（批次取得所有美股數據）
   */
  async fetch() {
    if (!this.apiKey) {
      logger.warn('FMP_API_KEY 未設定，跳過');
      return { quotes: {}, earnings: [], source: 'fmp', skipped: true };
    }

    // FMP 日配額檢查
    const quota = costLedger.checkFmpQuota();
    if (!quota.canCall) {
      logger.warn(`FMP 日配額已滿 (${quota.calls}/200)，跳過`);
      return { quotes: {}, earnings: [], source: 'fmp', skipped: true, reason: 'quota' };
    }

    const results = { quotes: {}, earnings: [], gainers: [], source: 'fmp' };

    // Call 1~N: 單支報價並行（免費版不支援批次，每支 1 call）
    const quotesCacheKey = `fmp-quotes-${this.watchlist.join('-')}`;
    const cachedQuotes = this.cache.get(quotesCacheKey, this.cacheTtl);
    if (cachedQuotes) {
      results.quotes = cachedQuotes;
      logger.info('使用 FMP 報價快取');
    } else {
      try {
        await rateLimiter.acquire('fmp');
        const quotes = await this._fetchQuotes(this.watchlist);
        results.quotes = quotes;
        this.cache.set(quotesCacheKey, quotes, { pretty: true });
        const fetchedCount = Object.keys(quotes).length;
        costLedger.recordApiCall('fmp');
        costLedger.incrementFmpQuota(fetchedCount); // 每支 1 call
        logger.info(`FMP 取得 ${fetchedCount} 支股票報價（${fetchedCount} calls）`);
      } catch (err) {
        logger.error('FMP 報價失敗', err);
      }
    }

    // Call 2: 本周財報日曆
    const earningsCacheKey = 'fmp-earnings-weekly';
    const cachedEarnings = this.cache.get(earningsCacheKey, this.cacheTtl);
    if (cachedEarnings) {
      results.earnings = cachedEarnings;
    } else {
      try {
        await rateLimiter.acquire('fmp');
        const earnings = await this._fetchEarningsCalendar();
        results.earnings = earnings;
        this.cache.set(earningsCacheKey, earnings, { pretty: true });
        costLedger.recordApiCall('fmp');
        costLedger.incrementFmpQuota();
        logger.info(`FMP 取得 ${earnings.length} 筆財報事件`);
      } catch (err) {
        logger.error('FMP 財報日曆失敗', err);
      }
    }

    // Call 3: 漲幅榜（選擇性，只有配額充足時才拉）
    const quotaAfter = costLedger.checkFmpQuota();
    if (quotaAfter.remaining > 50) {
      const gainersCacheKey = 'fmp-gainers';
      const cachedGainers = this.cache.get(gainersCacheKey, this.cacheTtl);
      if (cachedGainers) {
        results.gainers = cachedGainers;
      } else {
        try {
          await rateLimiter.acquire('fmp');
          const gainers = await this._fetchGainers();
          results.gainers = gainers;
          this.cache.set(gainersCacheKey, gainers, { pretty: true });
          costLedger.recordApiCall('fmp');
          costLedger.incrementFmpQuota();
        } catch (err) {
          logger.error('FMP 漲幅榜失敗', err);
        }
      }
    }

    results.fetchedAt = new Date().toISOString();
    return results;
  }

  /**
   * 單支報價並行查詢（免費版不支援批次 ?symbols=，改用 ?symbol= 逐一並行）
   * 每支 1 call，watchlist 16 支 = 16 calls/run，遠低於 250/day 上限
   */
  async _fetchQuotes(symbols) {
    const results = await Promise.allSettled(
      symbols.map(async symbol => {
        const url = `${this.baseUrl}/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${this.apiKey}`;
        try {
          const data = await this._httpsGet(url);
          if (data && data.length > 0) {
            const q = data[0];
            // /stable/quote 不含 changesPercentage，手動計算
            const prevClose = q.price - q.change;
            const changesPercentage = prevClose !== 0
              ? parseFloat(((q.change / prevClose) * 100).toFixed(2))
              : 0;
            return {
              symbol: q.symbol,
              name: q.name,
              price: q.price,
              change: q.change,
              changesPercentage,
              dayLow: q.dayLow,
              dayHigh: q.dayHigh,
              volume: q.volume,
              marketCap: q.marketCap,
              timestamp: q.timestamp
            };
          }
        } catch (err) {
          logger.warn(`FMP 單支報價失敗 ${symbol}: ${err.message}`);
        }
        return null;
      })
    );

    const quotes = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        quotes[r.value.symbol] = r.value;
      }
    }
    return quotes;
  }

  /**
   * 本周財報日曆
   */
  async _fetchEarningsCalendar() {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const url = `${this.baseUrl}/stable/earning-calendar?from=${from}&to=${to}&apikey=${this.apiKey}`;
    const data = await this._httpsGet(url);

    // 只保留 watchlist 裡的或市值前 50 大
    const watchSet = new Set(this.watchlist.map(s => s.toUpperCase()));
    return data
      .filter(e => watchSet.has(e.symbol?.toUpperCase()))
      .map(e => ({
        symbol: e.symbol,
        date: e.date,
        time: e.time,
        epsEstimated: e.epsEstimated,
        revenueEstimated: e.revenueEstimated,
        fiscalDateEnding: e.fiscalDateEnding
      }));
  }

  /**
   * 漲幅榜
   */
  async _fetchGainers() {
    const url = `${this.baseUrl}/stable/stock-market-gainers?apikey=${this.apiKey}`;
    const data = await this._httpsGet(url);
    return (data || []).slice(0, 10).map(g => ({
      symbol: g.symbol,
      name: g.name,
      change: g.change,
      changesPercentage: g.changesPercentage,
      price: g.price
    }));
  }

  /**
   * HTTPS GET 工具方法
   */
  _httpsGet(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: { 'User-Agent': 'MarketDigest/1.0' }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`FMP JSON parse error: ${e.message}`));
            }
          } else if (res.statusCode === 404) {
            // 免費版不支援的 endpoint 回傳 404，靜默回傳空陣列
            resolve([]);
          } else {
            reject(new Error(`FMP API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('FMP API timeout (15s)'));
      });
      req.end();
    });
  }

  async fetchMarketData(symbol) {
    const result = await this.fetch();
    return result.quotes[symbol] || null;
  }

  async fetchNews() {
    // FMP 不提供新聞（用 Perplexity 取代）
    return [];
  }
}

module.exports = FMPPlugin;
