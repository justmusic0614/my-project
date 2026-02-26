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
  '^GSPC':    'SP500',
  '^IXIC':    'NASDAQ',
  '^DJI':     'DJI',
  '^VIX':     'VIX',
  'DX-Y.NYB': 'DXY',    // 美元指數（FMP fallback 用）
  '^TNX':     'US10Y',  // 美國10年期公債殖利率（FMP fallback 用）
  'USDTWD=X': 'USDTWD',
  'GC=F':     'GOLD',
  'CL=F':     'OIL_WTI',
  'HG=F':     'COPPER',
  'BTC-USD':  'BTC'
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

  /**
   * 取得 SPY ETF 成交量（用於市場情緒評估）
   * @returns {Promise<object|null>} { current, price, source, fetchedAt }
   */
  async getSPYVolume() {
    try {
      const data = await this.withRetry(
        () => this._get(`${YAHOO_BASE}${encodeURIComponent('SPY')}?interval=1d&range=1d`),
        2, null
      );
      const meta = data?.chart?.result?.[0]?.meta;
      const volume = meta?.regularMarketVolume;
      if (!volume) return null;
      return {
        current:   volume,
        price:     meta.regularMarketPrice || null,
        source:    'yahoo',
        fetchedAt: new Date().toISOString()
      };
    } catch (err) {
      this.logger.warn(`SPY volume fetch failed: ${err.message}`);
      return null;
    }
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

  /**
   * 取得歷史日線資料（週日 pipeline 用）
   * @param {string} symbol - Yahoo symbol（如 'SPY', '^GSPC', 'RSP'）
   * @param {number} days - 需要的天數（預設 250）
   * @returns {Promise<Array<{date:string, open:number|null, high:number|null, low:number|null, close:number, volume:number|null}>>}
   *          升冪排序，取最近 days 筆；bars 不足不 throw
   */
  async fetchHistoricalPrices(symbol, days = 250) {
    const range = days <= 252 ? '1y' : '2y';
    const encoded = encodeURIComponent(symbol);
    const url = `${YAHOO_BASE}${encoded}?interval=1d&range=${range}`;

    let raw;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await this._get(url);
        break;
      } catch (err) {
        lastErr = err;
        const msg = err.message;
        // 404 或解析失敗 → 不 retry
        if (msg.includes('404') || msg.includes('JSON parse')) throw err;
        // 429/5xx → retry with backoff
        if (attempt < 2) {
          const wait = attempt === 0 ? 1000 : 3000;
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }
    if (!raw) throw lastErr || new Error(`fetchHistoricalPrices failed for ${symbol}`);

    const result = raw?.chart?.result?.[0];
    if (!result) throw new Error(`No chart data for ${symbol}`);

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const opens  = quotes.open   || [];
    const highs  = quotes.high   || [];
    const lows   = quotes.low    || [];
    const closes = quotes.close  || [];
    const vols   = quotes.volume || [];

    const bars = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      // 只保留 close 為 number 的 bar
      if (typeof close !== 'number' || isNaN(close)) continue;

      const d = new Date(timestamps[i] * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      bars.push({
        date:   dateStr,
        open:   typeof opens[i] === 'number' ? opens[i] : null,
        high:   typeof highs[i] === 'number' ? highs[i] : null,
        low:    typeof lows[i]  === 'number' ? lows[i]  : null,
        close,
        volume: typeof vols[i]  === 'number' ? vols[i]  : null
      });
    }

    // 升冪排序，取最近 days 筆
    bars.sort((a, b) => a.date.localeCompare(b.date));
    return bars.slice(-days);
  }

  /**
   * 取得 VIX3M 最新收盤（選用指標）
   * @returns {Promise<number|null>} 收盤價；失敗 → null
   */
  async fetchVIX3M() {
    try {
      const encoded = encodeURIComponent('^VIX3M');
      const raw = await this._get(`${YAHOO_BASE}${encoded}?interval=1d&range=1d`);
      const close = raw?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof close === 'number' ? close : null;
    } catch (err) {
      this.logger.warn(`VIX3M fetch failed: ${err.message}`);
      return null;
    }
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
