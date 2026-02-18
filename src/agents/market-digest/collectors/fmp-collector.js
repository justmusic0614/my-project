/**
 * FMPCollector — Financial Modeling Prep 收集器
 * 負責：美股指數、Watchlist 報價、財報日曆、漲跌幅排名
 * 涵蓋 Phase 1 的美股收集（05:30）
 *
 * API: https://financialmodelingprep.com
 * Auth: FMP_API_KEY 環境變數
 * Quota: 免費版 250 req/day（config: dailyQuotaLimit: 200）
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');

const FMP_BASE = 'https://financialmodelingprep.com/api';
const CACHE_TTL = 1800000; // 30min

// 美股主要指數符號
const INDEX_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^VIX'];

// 宏觀指標符號（FMP 使用不同格式）
const MACRO_SYMBOLS = { DXY: 'DX-Y.NYB', US10Y: 'TNX' };

class FMPCollector extends BaseCollector {
  constructor(config = {}) {
    super('fmp', config);
    this.apiConfig = config.dataSources?.api?.fmp || {};
    this.apiKey = process.env.FMP_API_KEY || '';
    this.watchlist = this.apiConfig.watchlist || ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSM', 'AMD', 'QQQ', 'SPY'];
    this.quotaLimit = this.apiConfig.dailyQuotaLimit || 200;
  }

  /**
   * 主收集方法（Phase 1）
   * @returns {{ date, source, SP500, NASDAQ, DJI, VIX, DXY, US10Y, watchlist, gainers, losers, earnings }}
   */
  async collect() {
    if (!this.apiKey) {
      this.logger.warn('FMP_API_KEY not set, skipping FMP collection');
      return { source: 'fmp', error: 'no_api_key', fetchedAt: new Date().toISOString() };
    }

    const today = this._todayStr();
    const cacheKey = `fmp-daily-${today}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting FMP data');

      // 檢查配額
      const quota = this.costLedger.checkFmpQuota();
      if (!quota.canCall) {
        this.logger.warn(`FMP quota exhausted (${quota.calls}/${this.quotaLimit}), using cached data`);
        return null;
      }

      const result = {
        date:     today,
        source:   'fmp',
        fetchedAt: new Date().toISOString(),
        watchlist: {},
        gainers:   [],
        losers:    [],
        earnings:  []
      };

      // 並行取得：指數 + Watchlist 報價 + 財報日曆
      const apiCallCount = Math.ceil(this.watchlist.length) + 2; // 粗估
      this.costLedger.recordApiCall('fmp', apiCallCount);
      this.costLedger.incrementFmpQuota(apiCallCount);

      const [quotesResult, indexResult, earningsResult, gainersResult] = await Promise.allSettled([
        this.withRetry(() => this._fetchBatchQuotes(this.watchlist), 3, {}),
        this.withRetry(() => this._fetchIndexQuotes(), 3, {}),
        this.withRetry(() => this._fetchEarningsCalendar(), 2, []),
        this.withRetry(() => this._fetchGainersLosers(), 2, { gainers: [], losers: [] })
      ]);

      // 處理 Watchlist 報價
      if (quotesResult.status === 'fulfilled') {
        result.watchlist = quotesResult.value;
      }

      // 處理指數數據
      if (indexResult.status === 'fulfilled') {
        const idx = indexResult.value;
        if (idx['^GSPC'])  result.SP500  = this.makeDataPoint(idx['^GSPC'].price,  { changePct: idx['^GSPC'].changesPercentage,  source: 'fmp' });
        if (idx['^IXIC'])  result.NASDAQ = this.makeDataPoint(idx['^IXIC'].price,  { changePct: idx['^IXIC'].changesPercentage,  source: 'fmp' });
        if (idx['^DJI'])   result.DJI    = this.makeDataPoint(idx['^DJI'].price,   { changePct: idx['^DJI'].changesPercentage,   source: 'fmp' });
        if (idx['^VIX'])   result.VIX    = this.makeDataPoint(idx['^VIX'].price,   { changePct: idx['^VIX'].changesPercentage,   source: 'fmp' });
        if (idx['DX-Y.NYB']) result.DXY  = this.makeDataPoint(idx['DX-Y.NYB'].price, { changePct: idx['DX-Y.NYB'].changesPercentage, source: 'fmp' });
        if (idx['TNX'])    result.US10Y  = this.makeDataPoint(idx['TNX'].price,    { changePct: idx['TNX'].changesPercentage,    source: 'fmp' });
      }

      // 財報日曆
      if (earningsResult.status === 'fulfilled') {
        result.earnings = earningsResult.value.slice(0, 20);
      }

      // 漲跌幅排名
      if (gainersResult.status === 'fulfilled') {
        result.gainers = gainersResult.value.gainers?.slice(0, 5) || [];
        result.losers  = gainersResult.value.losers?.slice(0, 5)  || [];
      }

      return result;
    });
  }

  /** Batch 報價（一次取多支） */
  async _fetchBatchQuotes(symbols) {
    const joined = symbols.join(',');
    const data = await this._get(`${FMP_BASE}/v3/quote/${encodeURIComponent(joined)}?apikey=${this.apiKey}`);
    if (!Array.isArray(data)) return {};

    const result = {};
    for (const q of data) {
      result[q.symbol] = {
        symbol: q.symbol,
        name:   q.name,
        price:  q.price,
        change: q.change,
        changePct: q.changesPercentage,
        volume:    q.volume,
        marketCap: q.marketCap,
        fetchedAt: new Date().toISOString()
      };
    }
    return result;
  }

  /** 指數報價（^GSPC / ^IXIC / ^DJI / ^VIX / DXY / US10Y） */
  async _fetchIndexQuotes() {
    const symbols = [...INDEX_SYMBOLS, ...Object.values(MACRO_SYMBOLS)];
    const joined = symbols.map(s => encodeURIComponent(s)).join(',');
    const data = await this._get(`${FMP_BASE}/v3/quote/${joined}?apikey=${this.apiKey}`);
    if (!Array.isArray(data)) return {};

    const result = {};
    for (const q of data) result[q.symbol] = q;
    return result;
  }

  /** 財報日曆（未來 7 天） */
  async _fetchEarningsCalendar() {
    const from = this._todayStr();
    const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const data = await this._get(`${FMP_BASE}/v3/earning_calendar?from=${from}&to=${to}&apikey=${this.apiKey}`);
    if (!Array.isArray(data)) return [];

    return data.slice(0, 20).map(e => ({
      date:    e.date,
      symbol:  e.symbol,
      time:    e.time,
      epsEst:  e.epsEstimated,
      revEst:  e.revenueEstimated,
      type:    'earnings',
      source:  'fmp'
    }));
  }

  /** 漲跌幅排名 */
  async _fetchGainersLosers() {
    const [gainers, losers] = await Promise.all([
      this._get(`${FMP_BASE}/v3/stock_market/gainers?apikey=${this.apiKey}`),
      this._get(`${FMP_BASE}/v3/stock_market/losers?apikey=${this.apiKey}`)
    ]);

    const fmt = arr => (Array.isArray(arr) ? arr : []).slice(0, 5).map(s => ({
      symbol: s.symbol, name: s.name, price: s.price,
      changePct: s.changesPercentage, source: 'fmp'
    }));

    return { gainers: fmt(gainers), losers: fmt(losers) };
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'MarketDigest/2.0' },
        timeout: 12000
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
}

module.exports = FMPCollector;
