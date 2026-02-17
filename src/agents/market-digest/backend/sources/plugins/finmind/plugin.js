// FinMind Plugin — 台股 Market Enrich
// 完整覆蓋台灣前 50 大標的（0050/006208 成分股）
// Rate limit: Backer 1,600 req/hour → 每次 run 用 3-4 calls 即可覆蓋全部 50 支

const https = require('https');
const path = require('path');
const DataSourceAdapter = require('../../adapter');
const CacheManager = require('../../../../shared/cache-manager');
const rateLimiter = require('../../../../shared/rate-limiter');
const costLedger = require('../../../cost-ledger');
const { createLogger } = require('../../../../shared/logger');

const logger = createLogger('finmind-plugin');

// 0050 成分股代碼（台灣市值前 50 大）
const TW50_COMPONENTS = [
  '2330', '2454', '2317', '2382', '2881', '2882', '2891',
  '2308', '2303', '2412', '1301', '1303', '1326', '2886',
  '3711', '2002', '5880', '2884', '3034', '2885', '1216',
  '5871', '2892', '3231', '2207', '6505', '4938', '2357',
  '4904', '2912', '9910', '1101', '2345', '3037', '5876',
  '2327', '3008', '6669', '2301', '8046', '2395', '3045',
  '6488', '3529', '2379', '3661', '3443', '6547', '2603', '1590'
];

class FinMindPlugin extends DataSourceAdapter {
  constructor(config = {}) {
    super('FinMind', config);
    this.apiToken = process.env.FINMIND_API_TOKEN;
    this.baseUrl = config.baseUrl || 'https://api.finmindtrade.com/api/v4';
    this.watchlist = config.watchlist || ['2330', '0050', '0056'];
    this.tw50Filter = config.tw50Filter !== false;
    this.cache = new CacheManager(
      path.join(__dirname, '../../../../data/chip-cache'),
      { logger }
    );
    this.cacheTtl = config.cacheTtl || 3600000; // 1 小時
  }

  /**
   * Plugin 統一介面：fetch
   * 聰明策略：
   *   Call 1: 三大法人買賣超（全市場 1 call）→ 過濾 0050 成分股異動
   *   Call 2: 加權指數（TAIEX）日成交
   */
  async fetch() {
    if (!this.apiToken) {
      logger.warn('FINMIND_API_TOKEN 未設定，跳過');
      return { taiex: null, institutional: [], source: 'finmind', skipped: true };
    }

    const today = this._getLatestTradeDate();
    const results = { taiex: null, institutional: [], topMovers: [], tw50Prices: {}, source: 'finmind' };

    // Call 1: 三大法人買賣超
    const instCacheKey = `finmind-institutional-${today}`;
    const cachedInst = this.cache.get(instCacheKey, this.cacheTtl);
    if (cachedInst) {
      results.institutional = cachedInst.all || [];
      results.topMovers = cachedInst.topMovers || [];
      logger.info('使用 FinMind 法人資料快取');
    } else {
      try {
        await rateLimiter.acquire('finmind');
        const instData = await this._fetchInstitutionalInvestors(today);
        costLedger.recordApiCall('finmind');

        // 過濾 0050 成分股 + 排序
        const tw50Set = new Set(TW50_COMPONENTS);
        const tw50Data = instData.filter(d => tw50Set.has(d.stock_id));

        // 按外資買賣超金額排序，取前 10 名
        const topMovers = [...tw50Data]
          .sort((a, b) => Math.abs(b.Foreign_Investor_buy - b.Foreign_Investor_sell)
            - Math.abs(a.Foreign_Investor_buy - a.Foreign_Investor_sell))
          .slice(0, 10)
          .map(d => ({
            stockId: d.stock_id,
            foreignNetBuy: (d.Foreign_Investor_buy || 0) - (d.Foreign_Investor_sell || 0),
            investmentTrustNetBuy: (d.Investment_Trust_buy || 0) - (d.Investment_Trust_sell || 0),
            dealerNetBuy: (d.Dealer_buy || 0) - (d.Dealer_sell || 0),
            totalNetBuy: ((d.Foreign_Investor_buy || 0) - (d.Foreign_Investor_sell || 0)) +
                         ((d.Investment_Trust_buy || 0) - (d.Investment_Trust_sell || 0)) +
                         ((d.Dealer_buy || 0) - (d.Dealer_sell || 0))
          }));

        const cacheData = { all: tw50Data, topMovers };
        this.cache.set(instCacheKey, cacheData, { pretty: true });
        results.institutional = tw50Data;
        results.topMovers = topMovers;
        logger.info(`FinMind 取得法人資料，0050 異動前 10: ${topMovers.map(m => m.stockId).join(',')}`);
      } catch (err) {
        logger.error('FinMind 法人資料失敗', err);
      }
    }

    // Call 2: 加權指數日成交
    const taiexCacheKey = `finmind-taiex-${today}`;
    const cachedTaiex = this.cache.get(taiexCacheKey, this.cacheTtl);
    if (cachedTaiex) {
      results.taiex = cachedTaiex;
    } else {
      try {
        await rateLimiter.acquire('finmind');
        const taiexData = await this._fetchTaiex(today);
        costLedger.recordApiCall('finmind');

        if (taiexData && taiexData.length > 0) {
          const latest = taiexData[taiexData.length - 1];
          results.taiex = {
            date: latest.date,
            open: latest.Open,
            high: latest.max,
            low: latest.min,
            close: latest.close,
            volume: latest.Trading_Volume,
            change: latest.spread
          };
          this.cache.set(taiexCacheKey, results.taiex, { pretty: true });
          logger.info(`FinMind TAIEX: ${results.taiex.close} (${results.taiex.change > 0 ? '+' : ''}${results.taiex.change})`);
        }
      } catch (err) {
        logger.error('FinMind TAIEX 失敗', err);
      }
    }

    // Call 3: 全部 50 支個股日成交（收盤價 + 成交量 + 漲跌）
    const pricesCacheKey = `finmind-tw50prices-${today}`;
    const cachedPrices = this.cache.get(pricesCacheKey, this.cacheTtl);
    if (cachedPrices) {
      results.tw50Prices = cachedPrices;
      logger.info('使用 FinMind 個股價格快取');
    } else {
      try {
        await rateLimiter.acquire('finmind');
        const priceData = await this._fetchDailyTrading(today);
        costLedger.recordApiCall('finmind');

        // 過濾 0050 成分股
        const tw50Set = new Set(TW50_COMPONENTS);
        const tw50Prices = {};
        for (const d of priceData) {
          if (tw50Set.has(d.stock_id)) {
            tw50Prices[d.stock_id] = {
              stockId: d.stock_id,
              date: d.date,
              open: d.open,
              high: d.max,
              low: d.min,
              close: d.close,
              volume: d.Trading_Volume,
              change: d.spread,
              changePct: d.close > 0 ? parseFloat(((d.spread / (d.close - d.spread)) * 100).toFixed(2)) : 0
            };
          }
        }

        this.cache.set(pricesCacheKey, tw50Prices, { pretty: true });
        results.tw50Prices = tw50Prices;
        logger.info(`FinMind 取得 ${Object.keys(tw50Prices).length} 支個股價格`);
      } catch (err) {
        logger.error('FinMind 個股價格失敗', err);
      }
    }

    // Call 4: 月營收（僅月初 1-10 日抓取，月營收在此區間陸續公佈）
    const dayOfMonth = new Date().getDate();
    const revenueTargets = ['2330', '2317', '2454', '2382', '2308']; // 台積電、鴻海、聯發科、廣達、台達電
    const revenueCacheKey = `finmind-monthly-revenue-${today.slice(0, 7)}`; // 按月快取
    const revenueCache = this.cache.get(revenueCacheKey, 86400000); // 24 小時快取
    if (revenueCache) {
      results.monthlyRevenue = revenueCache;
      logger.info('使用 FinMind 月營收快取');
    } else if (dayOfMonth <= 10) {
      try {
        await rateLimiter.acquire('finmind');
        const revenueData = await this._fetchMonthlyRevenue(revenueTargets);
        costLedger.recordApiCall('finmind');
        this.cache.set(revenueCacheKey, revenueData, { pretty: true });
        results.monthlyRevenue = revenueData;
        logger.info(`FinMind 月營收取得 ${revenueData.length} 筆`);
      } catch (err) {
        logger.error('FinMind 月營收失敗', err);
        results.monthlyRevenue = [];
      }
    } else {
      results.monthlyRevenue = []; // 月中以後不重新抓取，避免浪費配額
    }

    results.fetchedAt = new Date().toISOString();
    return results;
  }

  /**
   * 月營收資料（指定標的，取最近 2 個月方便計算 MoM）
   * 僅月初 1-10 日呼叫（月營收在此區間陸續公佈）
   */
  async _fetchMonthlyRevenue(stockIds) {
    const today = new Date();
    // 取最近 2 個月範圍（含上月與本月，讓前端可以算 MoM）
    const twoMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const startDate = twoMonthsAgo.toISOString().slice(0, 10);
    const endDate = today.toISOString().slice(0, 10);

    const allRevenue = [];
    for (const stockId of stockIds) {
      const params = new URLSearchParams({
        dataset: 'TaiwanStockMonthRevenue',
        data_id: stockId,
        start_date: startDate,
        end_date: endDate,
        token: this.apiToken
      });
      const url = `${this.baseUrl}/data?${params}`;
      try {
        const result = await this._httpsGet(url);
        const rows = result.data || [];
        // 計算 YoY / MoM（若有足夠資料）
        if (rows.length >= 2) {
          const latest = rows[rows.length - 1];
          const prev = rows[rows.length - 2];
          allRevenue.push({
            stockId,
            date: latest.date,
            revenue: latest.revenue,
            mom: prev.revenue > 0
              ? parseFloat(((latest.revenue - prev.revenue) / prev.revenue * 100).toFixed(2))
              : null,
            yoy: latest.revenue_year > 0
              ? parseFloat(((latest.revenue - latest.revenue_year) / latest.revenue_year * 100).toFixed(2))
              : null
          });
        } else if (rows.length === 1) {
          const latest = rows[0];
          allRevenue.push({
            stockId,
            date: latest.date,
            revenue: latest.revenue,
            mom: null,
            yoy: latest.revenue_year > 0
              ? parseFloat(((latest.revenue - latest.revenue_year) / latest.revenue_year * 100).toFixed(2))
              : null
          });
        }
      } catch (err) {
        logger.warn(`FinMind 月營收失敗 ${stockId}: ${err.message}`);
      }
    }
    return allRevenue;
  }

  /**
   * 個股日成交資料（指定日期，全市場 1 call）
   */
  async _fetchDailyTrading(date) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockPrice',
      start_date: date,
      end_date: date,
      token: this.apiToken
    });
    const url = `${this.baseUrl}/data?${params}`;
    const result = await this._httpsGet(url);
    return result.data || [];
  }

  /**
   * 三大法人買賣超（全市場，1 call 回傳所有股票）
   */
  async _fetchInstitutionalInvestors(date) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
      start_date: date,
      end_date: date,
      token: this.apiToken
    });
    const url = `${this.baseUrl}/data?${params}`;
    const result = await this._httpsGet(url);
    return result.data || [];
  }

  /**
   * 加權指數日成交
   */
  async _fetchTaiex(date) {
    const params = new URLSearchParams({
      dataset: 'TaiwanStockTotalReturnIndex',
      data_id: 'TAIEX',
      start_date: date,
      end_date: date,
      token: this.apiToken
    });
    const url = `${this.baseUrl}/data?${params}`;
    const result = await this._httpsGet(url);
    return result.data || [];
  }

  /**
   * 取得最近交易日（週末則退回到週五）
   */
  _getLatestTradeDate() {
    const now = new Date();
    const day = now.getDay();
    if (day === 0) now.setDate(now.getDate() - 2); // 週日 → 週五
    if (day === 6) now.setDate(now.getDate() - 1); // 週六 → 週五
    return now.toISOString().slice(0, 10);
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
              reject(new Error(`FinMind JSON parse error: ${e.message}`));
            }
          } else {
            reject(new Error(`FinMind API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('FinMind API timeout (15s)'));
      });
      req.end();
    });
  }

  async fetchMarketData() {
    const result = await this.fetch();
    return result.taiex;
  }

  async fetchNews() {
    return []; // FinMind 不提供新聞
  }
}

module.exports = FinMindPlugin;
module.exports.TW50_COMPONENTS = TW50_COMPONENTS;
