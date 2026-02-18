/**
 * FinMindCollector — FinMind 台股資料收集器
 * 負責：TAIEX（交叉比對用）、台股個股報價、三大法人（交叉比對用）
 * 主要用途：Phase 2 台股收集 + 交叉比對 TWSE 數據
 *
 * API: https://api.finmindtrade.com/api/v4
 * Auth: FINMIND_API_TOKEN 環境變數
 * Quota: Backer 方案 1600 req/hr
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');

const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4';
const CACHE_TTL = 3600000; // 1h

class FinMindCollector extends BaseCollector {
  constructor(config = {}) {
    super('finmind', config);
    this.apiConfig = config.dataSources?.api?.finmind || {};
    this.token = process.env.FINMIND_API_TOKEN || '';
    this.watchlist = this.apiConfig.watchlist || ['2330', '0050', '0056'];
  }

  /**
   * 主收集方法
   * @returns {{ date, source, TAIEX, tw50Prices, institutional, topMovers }}
   */
  async collect() {
    if (!this.token) {
      this.logger.warn('FINMIND_API_TOKEN not set, skipping FinMind collection');
      return { source: 'finmind', error: 'no_token', fetchedAt: new Date().toISOString() };
    }

    const today = this._latestTradingDay();
    const cacheKey = `finmind-daily-${today}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting FinMind data', { date: today });
      this.costLedger.recordApiCall('finmind', 3);

      const [taiexResult, pricesResult, instResult] = await Promise.allSettled([
        this.withRetry(() => this._fetchTaiex(today), 3, null),
        this.withRetry(() => this._fetchWatchlistPrices(today), 3, {}),
        this.withRetry(() => this._fetchInstitutional(today), 2, null)
      ]);

      const result = {
        date:     today,
        source:   'finmind',
        fetchedAt: new Date().toISOString()
      };

      // TAIEX（供交叉比對）
      const taiex = taiexResult.status === 'fulfilled' ? taiexResult.value : null;
      if (taiex) {
        result.TAIEX = this.makeDataPoint(taiex.close, {
          change:    taiex.change,
          changePct: taiex.changePct,
          source:    'finmind'
        });
      }

      // 台股個股報價
      if (pricesResult.status === 'fulfilled') {
        result.tw50Prices = pricesResult.value;
      }

      // 三大法人（供交叉比對）
      const inst = instResult.status === 'fulfilled' ? instResult.value : null;
      if (inst) {
        result.institutional = inst;

        // 計算漲跌幅前5名（外資買超）
        const movers = Object.values(result.tw50Prices || {})
          .filter(p => p.foreignNet != null)
          .sort((a, b) => (b.foreignNet || 0) - (a.foreignNet || 0));

        result.topMovers = movers.slice(0, 5).map(p => ({
          symbol:    p.stockId,
          name:      p.name || p.stockId,
          price:     p.close,
          changePct: p.changePct,
          foreignNet: p.foreignNet,
          source:    'finmind'
        }));
      }

      return result;
    });
  }

  /** 加權指數（TaiwanStockInfo 台灣加權指數） */
  async _fetchTaiex(date) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockPrice',
      data_id: 'Y9999',
      start_date: date,
      end_date: date,
      token: this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return null;

    const row = data.data[0];
    const close  = parseFloat(row.close || '0');
    const open   = parseFloat(row.open  || '0');
    const change = close - open;

    return { close, change, changePct: open ? (change / open) * 100 : 0, volume: parseFloat(row.Trading_Volume || '0') / 1e8 };
  }

  /** 台股 Watchlist 個股價格 */
  async _fetchWatchlistPrices(date) {
    const result = {};
    // FinMind 支援批次 stock_id 以逗號分隔
    const ids = this.watchlist.join(',');
    const params = new URLSearchParams({
      dataset:    'TaiwanStockPrice',
      data_id:    ids,
      start_date: date,
      end_date:   date,
      token:      this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return result;

    for (const row of data.data) {
      const close = parseFloat(row.close || '0');
      const open  = parseFloat(row.open  || '0');
      result[row.stock_id] = {
        stockId:   row.stock_id,
        date:      row.date,
        open:      open,
        close:     close,
        high:      parseFloat(row.max  || '0'),
        low:       parseFloat(row.min  || '0'),
        volume:    parseFloat(row.Trading_Volume || '0'),
        change:    close - open,
        changePct: open ? ((close - open) / open) * 100 : 0
      };
    }
    return result;
  }

  /** 三大法人（TaiwanStockInstitutionalInvestorsBuySell） */
  async _fetchInstitutional(date) {
    const params = new URLSearchParams({
      dataset:    'TaiwanStockInstitutionalInvestorsBuySell',
      start_date: date,
      end_date:   date,
      token:      this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return null;

    let foreign = 0, trust = 0, dealer = 0;
    for (const row of data.data) {
      const net = (parseInt(row.buy || '0', 10) - parseInt(row.sell || '0', 10));
      if (row.name === '外資') foreign += net;
      else if (row.name === '投信') trust += net;
      else if (row.name === '自營商') dealer += net;
    }

    return { foreign, trust, dealer, fetchedAt: new Date().toISOString() };
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'MarketDigest/2.0' },
        timeout: 15000
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

  /** 若今天是週末，退回最近一個交易日（週五） */
  _latestTradingDay() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 6=Sat
    let offset = 0;
    if (day === 0) offset = 2; // 週日 → 週五
    if (day === 6) offset = 1; // 週六 → 週五
    const d = new Date(now.getTime() - offset * 86400000);
    return d.toISOString().slice(0, 10);
  }
}

module.exports = FinMindCollector;
