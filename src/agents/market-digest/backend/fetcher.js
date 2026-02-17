// Market Data Fetcher - 協調所有數據源
// 已更新：整合 Yahoo/Perplexity/FMP/FinMind 四源 Pipeline

const YahooFinancePlugin = require('./sources/plugins/yahoo-finance/plugin');
const TWSEPlugin = require('./sources/plugins/twse/plugin');
const PerplexityPlugin = require('./sources/plugins/perplexity/plugin');
const FMPPlugin = require('./sources/plugins/fmp/plugin');
const FinMindPlugin = require('./sources/plugins/finmind/plugin');
const rateLimiter = require('../shared/rate-limiter');
const costLedger = require('./cost-ledger');
const fs = require('fs');
const path = require('path');

class MarketDataFetcher {
  constructor(config) {
    this.config = config;

    // 初始化 rate limiter
    if (config.rateLimits) {
      rateLimiter.init(config.rateLimits);
    }

    // 初始化 cost ledger
    if (config.costLedger) {
      costLedger.init(config.costLedger);
    }

    // 初始化 Yahoo Finance Plugin（fallback）
    this.yahooPlugin = new YahooFinancePlugin({
      baseUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/'
    });

    // 初始化 TWSE Plugin（fallback）
    this.twsePlugin = new TWSEPlugin({
      baseUrl: 'https://www.twse.com.tw'
    });

    // 初始化新 Plugins
    const apiConfig = config.dataSources?.api || {};
    this.perplexityPlugin = new PerplexityPlugin(apiConfig.perplexity || {});
    this.fmpPlugin = new FMPPlugin(apiConfig.fmp || {});
    this.finmindPlugin = new FinMindPlugin(apiConfig.finmind || {});
  }

  /**
   * 抓取市場數據（主要方法）
   */
  async fetchMarketData() {
    const results = {};

    // 台股
    if (this.config.data_sources.market_data.tw_stock?.enabled) {
      try {
        const symbol = this.config.data_sources.market_data.tw_stock.symbol;
        results.tw_stock = await this.yahooPlugin.fetchMarketData(symbol);
        
        // 計算技術指標
        if (this.config.technical_indicators?.enabled) {
          results.tw_stock_indicators = await this.yahooPlugin.fetchTechnicalIndicators(
            symbol,
            this.config.technical_indicators
          );
        }
      } catch (err) {
        console.error('[台股數據] 抓取失敗:', err.message);
      }
    }

    // 美股
    if (this.config.data_sources.market_data.us_stock?.enabled) {
      try {
        const symbols = this.config.data_sources.market_data.us_stock.symbols;
        results.us_stock = {};
        
        for (const symbol of symbols) {
          const data = await this.yahooPlugin.fetchMarketData(symbol);
          const key = symbol.replace('^', '').toLowerCase();
          results.us_stock[key] = data;
        }
      } catch (err) {
        console.error('[美股數據] 抓取失敗:', err.message);
      }
    }

    // 匯率
    if (this.config.data_sources.market_data.fx?.enabled) {
      try {
        const pair = this.config.data_sources.market_data.fx.pair;
        results.fx = await this.yahooPlugin.fetchMarketData(pair);
      } catch (err) {
        console.error('[匯率數據] 抓取失敗:', err.message);
      }
    }

    // 三大法人
    if (this.config.data_sources.market_data.institutional_investors?.enabled) {
      try {
        console.log('[三大法人] 抓取數據...');
        const institutionalData = await this.twsePlugin.fetchInstitutionalInvestors();
        results.institutional_investors = institutionalData;
        
        // 抓取歷史數據（用於計算累積趨勢）
        const historicalDays = this.config.data_sources.market_data.institutional_investors.historical_days || 5;
        const historicalData = await this.twsePlugin.fetchHistoricalInstitutionalInvestors(historicalDays);
        results.institutional_investors_history = historicalData;
        
        console.log('[三大法人] ✅ 抓取完成');
      } catch (err) {
        console.error('[三大法人] 抓取失敗:', err.message);
      }
    }

    return results;
  }

  /**
   * 載入快取（保留以相容舊代碼）
   */
  loadCache(file) {
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        console.error(`⚠️  快取檔案損壞 (${file}): ${err.message}`);
        console.log('🔄 將使用空快取...');
        return [];
      }
    }
    return [];
  }

  /**
   * 取得最近新聞（保留以相容舊代碼，但實際不使用）
   * @deprecated 當前系統使用 LINE 群組早報，不使用 RSS
   */
  getRecentNews(maxAgeHours = 24) {
    console.warn('⚠️  getRecentNews() 已棄用：當前系統使用 LINE 群組早報');
    return [];
  }

  /**
   * 抓取所有新聞（已棄用）
   * @deprecated 當前系統使用 LINE 群組早報，不使用 RSS
   */
  async fetchAllNews() {
    console.warn('⚠️  fetchAllNews() 已棄用：當前系統使用 LINE 群組早報');
    return {
      total: 0,
      new: 0,
      cached: 0
    };
  }

  /**
   * === 四步 Pipeline ===
   * Step 1: News Fetch（Perplexity + RSS）
   * Step 2: Market Enrich（FMP 美股 + FinMind 台股）
   * Step 3: 回傳合併結果（Dedup 由 smart-integrator 處理）
   */
  async fetchPipeline() {
    costLedger.startRun();
    const results = {
      news: { perplexity: [], rss: [] },
      market: { fmp: {}, finmind: {}, yahoo: {} },
      costSummary: null,
      errors: []
    };

    // Step 1 + Step 2 並行：新聞 + 市場數據同時抓
    const [perplexityResult, fmpResult, finmindResult, yahooResult] = await Promise.allSettled([
      // Step 1: Perplexity 新聞
      this.perplexityPlugin.fetch().catch(err => {
        results.errors.push({ source: 'perplexity', error: err.message });
        return { news: [], skipped: true };
      }),
      // Step 2a: FMP 美股
      this.fmpPlugin.fetch().catch(err => {
        results.errors.push({ source: 'fmp', error: err.message });
        return { quotes: {}, earnings: [], skipped: true };
      }),
      // Step 2b: FinMind 台股
      this.finmindPlugin.fetch().catch(err => {
        results.errors.push({ source: 'finmind', error: err.message });
        return { taiex: null, institutional: [], skipped: true };
      }),
      // Fallback: Yahoo Finance（現有數據）
      this.fetchMarketData().catch(err => {
        results.errors.push({ source: 'yahoo', error: err.message });
        return {};
      })
    ]);

    // 合併結果
    results.news.perplexity = perplexityResult.status === 'fulfilled'
      ? (perplexityResult.value.news || [])
      : [];
    results.market.fmp = fmpResult.status === 'fulfilled'
      ? fmpResult.value
      : {};
    results.market.finmind = finmindResult.status === 'fulfilled'
      ? finmindResult.value
      : {};
    results.market.yahoo = yahooResult.status === 'fulfilled'
      ? yahooResult.value
      : {};

    // 寫入成本記帳
    const daily = costLedger.flush();
    results.costSummary = costLedger.getDailySummary();

    return results;
  }
}

module.exports = MarketDataFetcher;
