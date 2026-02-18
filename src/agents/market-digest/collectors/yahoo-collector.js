/**
 * YahooCollector — Yahoo Finance 收集器
 * 負責：全球指數（SP500/Nasdaq 交叉比對）、匯率、大宗商品、加密貨幣
 * 無需 API Key（公開 API）
 *
 * 主要用於：
 *   Phase 1 (05:30)：美股指數 fallback + 大宗商品
 *   Phase 2 (07:30)：USD/TWD 交叉比對
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CACHE_TTL = 300000; // 5min（市場數據快速過期）

// symbol → 收集結果 key 的映射
const SYMBOL_MAP = {
  '^GSPC':   'SP500',
  '^IXIC':   'NASDAQ',
  '^DJI':    'DJI',
  '^VIX':    'VIX',
  'USDTWD=X': 'USDTWD',
  'GC=F':    'GOLD',
  'CL=F':    'OIL_WTI',
  'HG=F':    'COPPER',
  'BTC-USD': 'BTC'
};

class YahooCollector extends BaseCollector {
  constructor(config = {}) {
    super('yahoo', config);
    this.symbols = Object.keys(SYMBOL_MAP);
  }

  /**
   * 主收集方法
   * @returns {{ date, source, SP500, NASDAQ, DJI, VIX, USDTWD, GOLD, OIL_WTI, COPPER, BTC }}
   */
  async collect() {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `yahoo-daily-${today}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting Yahoo Finance data');
      this.costLedger.recordApiCall('yahoo', this.symbols.length);

      const result = {
        date:     today,
        source:   'yahoo',
        fetchedAt: new Date().toISOString()
      };

      // 並行取得所有 symbols（Yahoo 不支援 batch，需個別請求）
      const fetches = this.symbols.map(symbol =>
        this.withRetry(() => this._fetchSymbol(symbol), 2, null)
          .then(data => ({ symbol, data }))
          .catch(err => { this.logger.warn(`yahoo fetch failed: ${symbol}`, { error: err.message }); return { symbol, data: null }; })
      );

      const results = await Promise.all(fetches);

      for (const { symbol, data } of results) {
        const key = SYMBOL_MAP[symbol];
        if (!key) continue;

        if (data) {
          result[key] = this.makeDataPoint(data.close, {
            change:    data.change,
            changePct: data.changePct,
            source:    'yahoo'
          });
        } else {
          result[key] = { value: null, degraded: 'NA', source: 'yahoo', fetchedAt: new Date().toISOString() };
        }
      }

      return result;
    });
  }

  /** 取得單一 symbol 的最新報價 */
  async _fetchSymbol(symbol) {
    await this.rateLimiter.acquire('yahoo');
    const encoded = encodeURIComponent(symbol);
    const url = `${YAHOO_BASE}${encoded}?interval=1d&range=2d`;

    const raw = await this._get(url);
    const result = raw?.chart?.result?.[0];
    if (!result) throw new Error(`no data for ${symbol}`);

    const meta = result.meta;
    const close   = meta.regularMarketPrice || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change  = close != null && prevClose != null ? close - prevClose : null;
    const changePct = prevClose ? (change / prevClose) * 100 : null;

    if (!close) throw new Error(`invalid price for ${symbol}`);

    return { symbol, close, change, changePct };
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarketDigest/2.0)',
          'Accept':     'application/json'
        },
        timeout: 10000
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
}

module.exports = YahooCollector;
