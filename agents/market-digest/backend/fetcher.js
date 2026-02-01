// Market Data Fetcher - 協調所有數據源
const YahooFinanceAdapter = require('./sources/yahoo');
const RSSAdapter = require('./sources/rss');
const fs = require('fs');
const path = require('path');

class MarketDataFetcher {
  constructor(config) {
    this.config = config;
    this.yahooAdapter = new YahooFinanceAdapter(config);
    this.rssAdapters = [];
    
    // 初始化 RSS adapters
    this.initRSSAdapters();
  }

  initRSSAdapters() {
    // 台股新聞
    if (this.config.data_sources.tw_news) {
      this.config.data_sources.tw_news
        .filter(source => source.enabled)
        .forEach(source => {
          this.rssAdapters.push(
            new RSSAdapter(source.name, source.url, this.config)
          );
        });
    }

    // 國際新聞
    if (this.config.data_sources.intl_news) {
      this.config.data_sources.intl_news
        .filter(source => source.enabled)
        .forEach(source => {
          this.rssAdapters.push(
            new RSSAdapter(source.name, source.url, this.config)
          );
        });
    }
  }

  async fetchAllNews() {
    const results = [];
    
    for (const adapter of this.rssAdapters) {
      try {
        const result = await adapter.fetchNews();
        results.push(result);
      } catch (err) {
        console.error(`[${adapter.name}] 抓取失敗:`, err.message);
      }
    }

    // 合併所有新聞
    const allArticles = results.flatMap(r => r.data);
    
    // 儲存到 cache
    const cacheFile = path.join(__dirname, '../data/cache/news-raw.json');
    const cache = this.loadCache(cacheFile);
    const newArticles = allArticles.filter(article => 
      !cache.some(cached => cached.guid === article.guid)
    );
    
    if (newArticles.length > 0) {
      cache.push(...newArticles);
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
      console.log(`✅ 新增 ${newArticles.length} 則新聞到快取`);
    } else {
      console.log(`ℹ️  無新增新聞`);
    }

    return {
      total: allArticles.length,
      new: newArticles.length,
      cached: cache.length
    };
  }

  async fetchMarketData() {
    const results = {};

    // 台股
    if (this.config.data_sources.market_data.tw_stock.enabled) {
      try {
        const symbol = this.config.data_sources.market_data.tw_stock.symbol;
        results.tw_stock = await this.yahooAdapter.fetchMarketData(symbol);
        
        if (this.config.technical_indicators.enabled) {
          results.tw_stock_indicators = await this.yahooAdapter.fetchTechnicalIndicators(
            symbol,
            this.config.technical_indicators
          );
        }
      } catch (err) {
        console.error('[台股數據] 抓取失敗:', err.message);
      }
    }

    // 美股
    if (this.config.data_sources.market_data.us_stock.enabled) {
      try {
        const symbols = this.config.data_sources.market_data.us_stock.symbols;
        results.us_stock = {};
        
        for (const symbol of symbols) {
          const data = await this.yahooAdapter.fetchMarketData(symbol);
          const key = symbol.replace('^', '').toLowerCase();
          results.us_stock[key] = data;
        }
      } catch (err) {
        console.error('[美股數據] 抓取失敗:', err.message);
      }
    }

    // 匯率
    if (this.config.data_sources.market_data.fx.enabled) {
      try {
        const pair = this.config.data_sources.market_data.fx.pair;
        results.fx = await this.yahooAdapter.fetchMarketData(pair);
      } catch (err) {
        console.error('[匯率數據] 抓取失敗:', err.message);
      }
    }

    return results;
  }

  loadCache(file) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    return [];
  }

  getRecentNews(maxAgeHours = 24) {
    const cacheFile = path.join(__dirname, '../data/cache/news-raw.json');
    const cache = this.loadCache(cacheFile);
    
    const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    
    return cache.filter(article => {
      const pubDate = new Date(article.pubDate);
      return pubDate.getTime() > cutoff;
    });
  }
}

module.exports = MarketDataFetcher;
