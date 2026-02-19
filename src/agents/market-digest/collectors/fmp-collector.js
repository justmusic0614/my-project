/**
 * FMPCollector — Financial Modeling Prep 收集器
 * 負責：美股指數、Watchlist 報價、財報日曆、漲跌幅排名
 * 涵蓋 Phase 1 的美股收集（05:30）
 *
 * API: https://financialmodelingprep.com
 * Auth: FMP_API_KEY 環境變數
 * Quota: Basic 250 req/day（dailyQuotaLimit: 200）/ Starter 300 req/min（無日配額上限）
 * Plan-aware: config.fmpPlan = "starter" | "basic"
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');
const { getApiKeys } = require('../shared/api-keys');

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const CACHE_TTL = 1800000; // 30min

// 美股主要指數符號
const INDEX_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^VIX'];

// 宏觀指標符號（FMP 使用不同格式）
const MACRO_SYMBOLS = { DXY: 'DX-Y.NYB', US10Y: 'TNX' };

class FMPCollector extends BaseCollector {
  constructor(config = {}) {
    super('fmp', config);
    this.apiConfig = config.dataSources?.api?.fmp || {};

    // 統一 API key 管理
    const apiKeys = getApiKeys();
    this.apiKey = apiKeys.getFmp();

    this.watchlist = this.apiConfig.watchlist || ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSM', 'AMD', 'QQQ', 'SPY'];
    this.quotaLimit = this.apiConfig.dailyQuotaLimit || 200;
    this.plan = this.apiConfig.fmpPlan || 'basic';
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

      // 檢查配額（starter 方案無每日上限，跳過配額檢查）
      if (this.plan !== 'starter') {
        const quota = this.costLedger.checkFmpQuota();
        if (!quota.canCall) {
          this.logger.warn(`FMP quota exhausted (${quota.calls}/${this.quotaLimit}), using cached data`);
          return null;
        }
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

      // 並行取得：指數 + Watchlist 報價 + 財報日曆（逐一查詢）
      const indexCount = INDEX_SYMBOLS.length + Object.keys(MACRO_SYMBOLS).length;
      const apiCallCount = this.watchlist.length + indexCount + 3; // watchlist + 指數 + earnings/gainers/losers
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
        if (idx['^GSPC'])  result.SP500  = this.makeDataPoint(idx['^GSPC'].price,  { changePct: idx['^GSPC'].changePercentage,  source: 'fmp' });
        if (idx['^IXIC'])  result.NASDAQ = this.makeDataPoint(idx['^IXIC'].price,  { changePct: idx['^IXIC'].changePercentage,  source: 'fmp' });
        if (idx['^DJI'])   result.DJI    = this.makeDataPoint(idx['^DJI'].price,   { changePct: idx['^DJI'].changePercentage,   source: 'fmp' });
        if (idx['^VIX'])   result.VIX    = this.makeDataPoint(idx['^VIX'].price,   { changePct: idx['^VIX'].changePercentage,   source: 'fmp' });
        if (idx['DX-Y.NYB']) result.DXY  = this.makeDataPoint(idx['DX-Y.NYB'].price, { changePct: idx['DX-Y.NYB'].changePercentage, source: 'fmp' });
        if (idx['TNX'])    result.US10Y  = this.makeDataPoint(idx['TNX'].price,    { changePct: idx['TNX'].changePercentage,    source: 'fmp' });
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

  /** 逐一報價（stable API 不支援多符號批次查詢） */
  async _fetchBatchQuotes(symbols) {
    const results = await Promise.allSettled(
      symbols.map(s => this._get(`${FMP_BASE}/quote?symbol=${encodeURIComponent(s)}&apikey=${this.apiKey}`))
    );

    const result = {};
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const arr = r.value;
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const q = arr[0];
      result[q.symbol] = {
        symbol: q.symbol,
        name:   q.name,
        price:  q.price,
        change: q.change,
        changePct: q.changePercentage,
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
    const results = await Promise.allSettled(
      symbols.map(s => this._get(`${FMP_BASE}/quote?symbol=${encodeURIComponent(s)}&apikey=${this.apiKey}`))
    );

    const result = {};
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const arr = r.value;
      if (!Array.isArray(arr) || arr.length === 0) continue;
      result[arr[0].symbol] = arr[0];
    }
    return result;
  }

  /** 財報日曆（未來 7 天） */
  async _fetchEarningsCalendar() {
    const from = this._todayStr();
    const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const data = await this._get(`${FMP_BASE}/earning-calendar?from=${from}&to=${to}&apikey=${this.apiKey}`);
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
      this._get(`${FMP_BASE}/gainers?apikey=${this.apiKey}`),
      this._get(`${FMP_BASE}/losers?apikey=${this.apiKey}`)
    ]);

    const fmt = arr => (Array.isArray(arr) ? arr : []).slice(0, 5).map(s => ({
      symbol: s.symbol, name: s.name, price: s.price,
      changePct: s.changePercentage, source: 'fmp'
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
          try {
            const parsed = JSON.parse(body);
            // FMP 錯誤格式：{ "Error Message": "..." }
            if (parsed && parsed['Error Message']) {
              this.logger.warn(`FMP API error: ${parsed['Error Message'].slice(0, 80)}`);
              resolve([]);
              return;
            }
            resolve(parsed);
          } catch (e) {
            // 非 JSON 回應（如 "Premium Quota exceeded"）→ 降級為空陣列
            this.logger.warn(`FMP non-JSON response: ${body.slice(0, 60)}`);
            resolve([]);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  /** 取得當前 plan 的功能限制資訊 */
  getPlanInfo() {
    return {
      plan:              this.plan,
      premiumAvailable:  this.plan !== 'starter',
      quotaEnforced:     this.plan !== 'starter'
    };
  }

  _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
}

module.exports = FMPCollector;
