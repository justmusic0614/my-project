#!/usr/bin/env node
/**
 * Yahoo Finance News API 搜集器
 * 搜集台股、美股相關財經新聞
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class YahooFinanceNews {
  constructor(config = {}) {
    this.baseUrl = 'https://query2.finance.yahoo.com/v1/finance/search';
    this.newsUrl = 'https://query1.finance.yahoo.com/v1/finance/news';
    this.symbols = config.symbols || ['TSMC', '^TWII', '^GSPC', 'NVDA'];
    this.maxResults = config.maxResults || 10;
  }

  /**
   * 搜集新聞
   */
  async fetchNews(symbol) {
    try {
      const response = await axios.get(this.newsUrl, {
        params: {
          symbols: symbol,
          count: this.maxResults,
          region: 'US'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarketDigest/1.0)'
        },
        timeout: 10000
      });

      if (response.data && response.data.items) {
        return response.data.items.result.map(item => ({
          title: item.title,
          link: item.link,
          publisher: item.publisher,
          publishedAt: new Date(item.providerPublishTime * 1000).toISOString(),
          summary: item.summary || '',
          type: item.type,
          relatedSymbols: item.relatedTickers || []
        }));
      }

      return [];
    } catch (error) {
      console.error(`[Yahoo Finance] 搜集 ${symbol} 新聞失敗:`, error.message);
      return [];
    }
  }

  /**
   * 搜集所有 symbols 的新聞
   */
  async fetchAll() {
    console.log(`[Yahoo Finance] 開始搜集新聞...`);
    const allNews = [];

    for (const symbol of this.symbols) {
      console.log(`[Yahoo Finance] 搜集 ${symbol}...`);
      const news = await this.fetchNews(symbol);
      allNews.push(...news);
      
      // 避免 rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 去重（根據 title）
    const uniqueNews = this.deduplicateNews(allNews);
    console.log(`[Yahoo Finance] 搜集完成：${allNews.length} 則 → 去重後 ${uniqueNews.length} 則`);

    return uniqueNews;
  }

  /**
   * 去重
   */
  deduplicateNews(newsList) {
    const seen = new Set();
    return newsList.filter(news => {
      const key = news.title.toLowerCase().trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * 儲存到檔案
   */
  async saveToFile(newsList, outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(newsList, null, 2), 'utf8');
    console.log(`[Yahoo Finance] 已儲存到：${outputPath}`);
  }
}

// CLI 使用
if (require.main === module) {
  (async () => {
    const config = {
      symbols: ['TSMC', '^TWII', '^GSPC', 'NVDA', 'AAPL', 'MSFT'],
      maxResults: 10
    };

    const collector = new YahooFinanceNews(config);
    const news = await collector.fetchAll();

    const today = new Date().toISOString().split('T')[0];
    const outputPath = path.join(__dirname, '../../data/news-collect', `${today}.json`);
    
    await collector.saveToFile(news, outputPath);
    console.log(`✅ 完成！共搜集 ${news.length} 則新聞`);
  })();
}

module.exports = YahooFinanceNews;
