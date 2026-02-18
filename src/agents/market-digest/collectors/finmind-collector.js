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

// 0050 成分股代碼（台灣市值前 50 大，供 Top5 漲跌幅排行用）
const TW50_COMPONENTS = [
  '2330', '2454', '2317', '2382', '2881', '2882', '2891',
  '2308', '2303', '2412', '1301', '1303', '1326', '2886',
  '3711', '2002', '5880', '2884', '3034', '2885', '1216',
  '5871', '2892', '3231', '2207', '6505', '4938', '2357',
  '4904', '2912', '9910', '1101', '2345', '3037', '5876',
  '2327', '3008', '6669', '2301', '8046', '2395', '3045',
  '6488', '3529', '2379', '3661', '3443', '6547', '2603', '1590'
];

class FinMindCollector extends BaseCollector {
  constructor(config = {}) {
    super('finmind', config);
    this.apiConfig = config.dataSources?.api?.finmind || {};
    this.token = process.env.FINMIND_API_TOKEN || '';
    this.watchlist = this.apiConfig.watchlist || ['2330', '0050', '0056'];
    this._stockNames = null; // TW50 股票名稱快取（動態查詢 TaiwanStockInfo）
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
      this.costLedger.recordApiCall('finmind', 6);

      const [taiexResult, pricesResult, instResult, tw50Result, marginResult] = await Promise.allSettled([
        this.withRetry(() => this._fetchTaiex(today), 3, null),
        this.withRetry(() => this._fetchWatchlistPrices(today), 3, {}),
        this.withRetry(() => this._fetchInstitutional(today), 2, null),
        this.withRetry(() => this._fetchTw50Prices(today), 2, {}),
        this.withRetry(() => this._fetchMarginTotal(today), 2, null)
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

      // TW50 漲跌幅 Top5
      if (tw50Result.status === 'fulfilled') {
        const tw50 = tw50Result.value;
        const sorted = Object.values(tw50).filter(p => p.changePct != null);

        result.twGainers = [...sorted]
          .sort((a, b) => b.changePct - a.changePct)
          .slice(0, 5)
          .map(p => ({ symbol: p.stockId, name: p.name, price: p.close, changePct: p.changePct, source: 'finmind' }));

        result.twLosers = [...sorted]
          .sort((a, b) => a.changePct - b.changePct)
          .slice(0, 5)
          .map(p => ({ symbol: p.stockId, name: p.name, price: p.close, changePct: p.changePct, source: 'finmind' }));

        result.tw50AllPrices = tw50;
      }

      // 融資融券（FinMind 全市場版）
      if (marginResult.status === 'fulfilled' && marginResult.value) {
        result.marginTotal = marginResult.value;
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
    const spread = parseFloat(row.spread || '0'); // 漲跌 = 今日收盤 - 前日收盤
    const prevClose = close - spread;

    return { close, change: spread, changePct: prevClose > 0 ? (spread / prevClose) * 100 : 0, volume: parseFloat(row.Trading_Volume || '0') / 1e8 };
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
      const close  = parseFloat(row.close || '0');
      const open   = parseFloat(row.open  || '0');
      const spread = parseFloat(row.spread || '0'); // 漲跌 = 今日收盤 - 前日收盤
      const prevClose = close - spread;
      result[row.stock_id] = {
        stockId:   row.stock_id,
        date:      row.date,
        open:      open,
        close:     close,
        high:      parseFloat(row.max  || '0'),
        low:       parseFloat(row.min  || '0'),
        volume:    parseFloat(row.Trading_Volume || '0'),
        change:    spread,
        changePct: prevClose > 0 ? (spread / prevClose) * 100 : 0
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

  /** 動態查詢 TW50 股票名稱（TaiwanStockInfo），快取在記憶體中 */
  async _fetchStockNames() {
    if (this._stockNames) return this._stockNames;
    const params = new URLSearchParams({ dataset: 'TaiwanStockInfo', token: this.token });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return {};

    const tw50Set = new Set(TW50_COMPONENTS);
    const names = {};
    for (const row of data.data) {
      if (tw50Set.has(row.stock_id)) {
        names[row.stock_id] = row.stock_name || row.stock_id;
      }
    }
    this._stockNames = names;
    return names;
  }

  /** TW50 成分股價格（供 Top5 漲跌幅排行用，1 次 API call） */
  async _fetchTw50Prices(date) {
    const ids = TW50_COMPONENTS.join(',');
    const params = new URLSearchParams({
      dataset: 'TaiwanStockPrice', data_id: ids,
      start_date: date, end_date: date, token: this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return {};

    const names = await this._fetchStockNames();
    const result = {};
    for (const row of data.data) {
      const close  = parseFloat(row.close || '0');
      const spread = parseFloat(row.spread || '0');
      const prevClose = close - spread;
      result[row.stock_id] = {
        stockId:   row.stock_id,
        name:      names[row.stock_id] || row.stock_id,
        close,
        spread,
        changePct: prevClose > 0 ? (spread / prevClose) * 100 : 0,
        volume:    parseFloat(row.Trading_Volume || '0')
      };
    }
    return result;
  }

  /** 全市場融資融券餘額（TaiwanStockTotalMarginPurchaseShortSale，1 次 API call） */
  async _fetchMarginTotal(date) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockTotalMarginPurchaseShortSale',
      start_date: date, end_date: date, token: this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return null;

    const row = data.data[0];
    const marginToday = parseInt(row.MarginPurchaseTodayBalance || '0', 10);
    const marginYes   = parseInt(row.MarginPurchaseYesBalance   || '0', 10);
    const shortToday  = parseInt(row.ShortSaleTodayBalance      || '0', 10);
    const shortYes    = parseInt(row.ShortSaleYesBalance        || '0', 10);

    return {
      marginBalance:    marginToday,
      marginYesBalance: marginYes,
      marginChange:     marginToday - marginYes,
      shortBalance:     shortToday,
      shortYesBalance:  shortYes,
      shortChange:      shortToday - shortYes,
      source:           'finmind'
    };
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
