// Market Data Fetcher - 協調所有數據源
// 已更新：使用 Yahoo Finance Plugin，移除舊的 RSS 架構

const YahooFinancePlugin = require('./sources/plugins/yahoo-finance/plugin');
const fs = require('fs');
const path = require('path');

class MarketDataFetcher {
  constructor(config) {
    this.config = config;
    
    // 初始化 Yahoo Finance Plugin
    this.yahooPlugin = new YahooFinancePlugin({
      baseUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/'
    });
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
}

module.exports = MarketDataFetcher;
