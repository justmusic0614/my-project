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
const { getApiKeys } = require('../shared/api-keys');

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

    // 統一 API key 管理
    const apiKeys = getApiKeys();
    this.token = apiKeys.getFinmind();

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
      // taiex(1) + allPrices/stockNames(2) + institutional(1) + margin(1) = 5
      this.costLedger.recordApiCall('finmind', 5);

      const [taiexResult, allPricesResult, instResult, marginResult] = await Promise.allSettled([
        this.withRetry(() => this._fetchTaiex(today), 3, null),
        this.withRetry(() => this._fetchAllPrices(today), 3, {}),
        this.withRetry(() => this._fetchInstitutional(today), 2, null),
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

      // 全市場價格 → 過濾出 watchlist 和 TW50
      if (allPricesResult.status === 'fulfilled') {
        const allPrices = allPricesResult.value;
        const tw50Set      = new Set(TW50_COMPONENTS);
        const watchlistSet = new Set(this.watchlist);

        // watchlist 個股報價（供交叉比對 + Watchlist 區塊）
        result.tw50Prices = {};
        for (const [id, p] of Object.entries(allPrices)) {
          if (watchlistSet.has(id)) result.tw50Prices[id] = p;
        }

        // 三大法人（供交叉比對）
        const inst = instResult.status === 'fulfilled' ? instResult.value : null;
        if (inst) {
          result.institutional = inst;
          const movers = Object.values(result.tw50Prices)
            .filter(p => p.foreignNet != null)
            .sort((a, b) => (b.foreignNet || 0) - (a.foreignNet || 0));
          result.topMovers = movers.slice(0, 5).map(p => ({
            symbol: p.stockId, name: p.name || p.stockId,
            price: p.close, changePct: p.changePct, foreignNet: p.foreignNet, source: 'finmind'
          }));
        }

        // TW50 漲跌幅 Top5
        const tw50List = Object.values(allPrices).filter(p => tw50Set.has(p.stockId) && p.changePct != null);
        result.twGainers = [...tw50List]
          .sort((a, b) => b.changePct - a.changePct).slice(0, 5)
          .map(p => ({ symbol: p.stockId, name: p.name, price: p.close, changePct: p.changePct, source: 'finmind' }));
        result.twLosers = [...tw50List]
          .sort((a, b) => a.changePct - b.changePct).slice(0, 5)
          .map(p => ({ symbol: p.stockId, name: p.name, price: p.close, changePct: p.changePct, source: 'finmind' }));
        result.tw50AllPrices = Object.fromEntries(
          Object.entries(allPrices).filter(([id]) => tw50Set.has(id))
        );
      } else {
        // allPrices 失敗，仍嘗試組裝三大法人
        const inst = instResult.status === 'fulfilled' ? instResult.value : null;
        if (inst) result.institutional = inst;
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

  /**
   * 全市場台股價格（不傳 data_id，Backer 支援）
   * FinMind TaiwanStockPrice 不支援逗號分隔 data_id，須查全市場後客端過濾。
   * 包含股票名稱（從 _fetchStockNames 快取）
   */
  async _fetchAllPrices(date) {
    const params = new URLSearchParams({
      dataset:    'TaiwanStockPrice',
      start_date: date,
      end_date:   date,
      token:      this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return {};

    const names = await this._fetchStockNames();
    const result = {};
    for (const row of data.data) {
      const close     = parseFloat(row.close  || '0');
      const spread    = parseFloat(row.spread || '0'); // 今日收盤 - 前日收盤
      const prevClose = close - spread;
      result[row.stock_id] = {
        stockId:   row.stock_id,
        name:      names[row.stock_id] || row.stock_id,
        date:      row.date,
        open:      parseFloat(row.open || '0'),
        close,
        high:      parseFloat(row.max  || '0'),
        low:       parseFloat(row.min  || '0'),
        volume:    parseFloat(row.Trading_Volume || '0'),
        spread,
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

  /**
   * 全市場融資融券餘額（TaiwanStockTotalMarginPurchaseShortSale）
   * API 回傳 name-based 多行：
   *   MarginPurchaseMoney → 融資金額（元）
   *   ShortSale          → 融券張數
   */
  async _fetchMarginTotal(date) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockTotalMarginPurchaseShortSale',
      start_date: date, end_date: date, token: this.token
    });
    const data = await this._get(`${FINMIND_BASE}/data?${params}`);
    if (!data?.data?.length) return null;

    // 按 name 索引各行
    const rows = {};
    for (const row of data.data) rows[row.name] = row;

    const mpm = rows['MarginPurchaseMoney'] || {};  // 融資金額，元
    const ss  = rows['ShortSale']           || {};  // 融券，張

    return {
      marginBalance:    mpm.TodayBalance || 0,  // 元（渲染時 / 1e8 = 億）
      marginYesBalance: mpm.YesBalance   || 0,
      marginChange:     (mpm.TodayBalance || 0) - (mpm.YesBalance || 0),
      shortBalance:     ss.TodayBalance  || 0,  // 張
      shortYesBalance:  ss.YesBalance    || 0,
      shortChange:      (ss.TodayBalance || 0) - (ss.YesBalance || 0),
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
