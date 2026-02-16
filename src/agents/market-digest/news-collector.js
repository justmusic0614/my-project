#!/usr/bin/env node
/**
 * Market Digest News Collector
 * 統一新聞搜集入口（整合 RSS）
 */

// 忽略 EPIPE 錯誤（當 stdout 管道提前關閉時）
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});

const { fetchAllNews } = require('./news-fetcher');
const fs = require('fs').promises;
const path = require('path');

class NewsCollector {
  constructor(config = {}) {
    this.config = config;
    this.keywords = config.keywords || [];
    this.coreOnly = config.coreOnly || false;
  }

  /**
   * 搜集所有來源的新聞（使用 RSS）
   */
  async collectAll() {
    console.log('🔄 開始搜集財經新聞（RSS）...');

    try {
      const result = await fetchAllNews({
        keywords: this.keywords.length > 0 ? this.keywords : null,
        deduplicate: true,
        coreOnly: this.coreOnly
      });

      console.log(`✅ 搜集完成：共 ${result.total} 則新聞`);
      return result.news;
    } catch (error) {
      console.error('[News Collector] RSS 搜集失敗:', error.message);
      return [];
    }
  }

  /**
   * 過濾關鍵字
   */
  filterByKeywords(newsList, keywords) {
    if (!keywords || keywords.length === 0) {
      return newsList;
    }

    return newsList.filter(news => {
      const text = `${news.title} ${news.summary}`.toLowerCase();
      return keywords.some(keyword => text.includes(keyword.toLowerCase()));
    });
  }

  /**
   * 儲存到檔案
   */
  async saveToFile(newsList, date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const outputPath = path.join(__dirname, 'data/news-collect', `${today}.json`);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    const output = {
      date: today,
      collectedAt: new Date().toISOString(),
      count: newsList.length,
      news: newsList
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`💾 已儲存到：${outputPath}`);
    
    return outputPath;
  }

  /**
   * 讀取已搜集的新聞
   */
  async loadFromFile(date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const filePath = path.join(__dirname, 'data/news-collect', `${today}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.news || [];
    } catch (error) {
      console.error(`[News Collector] 讀取 ${filePath} 失敗:`, error.message);
      return [];
    }
  }
}

// CLI 使用
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    
    // 預設關鍵字（符合 Chris 需求）
    const defaultKeywords = [
      // 總經關鍵字
      'Fed', 'CPI', '非農', '降息', '升息', 'GDP', '失業率',
      // 台股權值股
      '台積電', 'TSMC', '聯發科', '鴻海', '台股', '加權指數',
      // Watchlist 相關
      '南亞科', 'AI', '半導體', '記憶體',
      // 重大事件
      '財報', '法說會', '併購', '重訊'
    ];
    
    const config = {
      keywords: defaultKeywords,
      coreOnly: args.includes('--core-only')
    };

    const collector = new NewsCollector(config);
    
    // 搜集新聞
    const news = await collector.collectAll();
    
    console.log(`🔍 最終結果：${news.length} 則新聞`);
    
    // 儲存
    await collector.saveToFile(news);
    
    console.log('✅ 新聞搜集完成！');
  })();
}

module.exports = NewsCollector;
