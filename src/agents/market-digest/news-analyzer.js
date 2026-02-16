#!/usr/bin/env node
/**
 * Market Digest News Analyzer
 * 使用 AI 分析新聞重要性與市場意涵
 */

// 忽略 EPIPE 錯誤（當 stdout 管道提前關閉時）
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const AIClient = require('./ai-client');
const NewsDeduplicator = require('./news-deduplicator');

const execAsync = promisify(exec);

class NewsAnalyzer {
  constructor(config = {}) {
    this.config = config;
    this.watchlist = config.watchlist || [];
    
    // 初始化 AI Client
    this.aiClient = new AIClient({
      watchlist: this.watchlist
    });
  }

  /**
   * 分析單則新聞
   */
  async analyzeNews(news) {
    try {
      // 使用 AI Client 分析
      const analysis = await this.aiClient.analyze(news);
      return analysis;
    } catch (error) {
      console.error('[Analyzer] 分析失敗:', error.message);
      return {
        importance: 5,
        category: '其他',
        tags: [],
        marketImplication: '未分析',
        affectedAssets: [],
        reasoning: '分析失敗',
        inWatchlist: false,
        priority: 'low'
      };
    }
  }

  /**
   * 批次分析新聞
   */
  async analyzeAll(newsList) {
    console.log(`🔬 開始分析 ${newsList.length} 則新聞...`);
    const analyzed = [];

    for (const news of newsList) {
      console.log(`  分析：${news.title.substring(0, 50)}...`);
      const analysis = await this.analyzeNews(news);
      
      analyzed.push({
        ...news,
        analysis
      });

      // 避免 rate limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 排序（重要性由高到低）
    analyzed.sort((a, b) => b.analysis.importance - a.analysis.importance);

    console.log(`✅ 分析完成！`);
    return analyzed;
  }

  /**
   * 過濾重要新聞
   */
  filterByImportance(analyzedNews, minScore = 7) {
    return analyzedNews.filter(n => n.analysis.importance >= minScore);
  }

  /**
   * 儲存分析結果
   */
  async saveToFile(analyzedNews, date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const outputPath = path.join(__dirname, 'data/news-analyzed', `${today}.json`);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    const output = {
      date: today,
      analyzedAt: new Date().toISOString(),
      count: analyzedNews.length,
      news: analyzedNews
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`💾 已儲存分析結果到：${outputPath}`);
    
    return outputPath;
  }

  /**
   * 讀取分析結果
   */
  async loadFromFile(date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const filePath = path.join(__dirname, 'data/news-analyzed', `${today}.json`);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.news || [];
    } catch (error) {
      console.error(`[Analyzer] 讀取 ${filePath} 失敗:`, error.message);
      return [];
    }
  }
}

// CLI 使用
if (require.main === module) {
  (async () => {
    const NewsCollector = require('./news-collector');
    
    // 解析參數
    const args = process.argv.slice(2);
    const enableDedup = !args.includes('--no-dedup');
    
    // 載入 watchlist
    let watchlist = [];
    try {
      const watchlistPath = path.join(__dirname, 'data/watchlist.json');
      const watchlistData = await fs.readFile(watchlistPath, 'utf8');
      const data = JSON.parse(watchlistData);
      watchlist = data.stocks || [];
      console.log(`📊 載入 Watchlist：${watchlist.length} 檔股票`);
    } catch (error) {
      console.log('⚠️  無法載入 Watchlist，將不進行個股加權');
    }
    
    const collector = new NewsCollector();
    const analyzer = new NewsAnalyzer({ watchlist });

    // 讀取今日新聞
    const news = await collector.loadFromFile();
    
    if (news.length === 0) {
      console.log('⚠️  沒有新聞可分析，請先執行 news-collector.js');
      process.exit(1);
    }

    // 分析
    const analyzed = await analyzer.analyzeAll(news);
    
    // 去重（選項）
    let finalNews = analyzed;
    if (enableDedup) {
      const deduplicator = new NewsDeduplicator({
        dedup_threshold: 0.75,
        limits: {
          critical: 3,
          high: 10,
          medium: 30
        }
      });
      
      const result = await deduplicator.deduplicate(analyzed);
      finalNews = result.news;
    } else {
      console.log('⚠️  跳過去重（使用 --no-dedup）');
    }
    
    // 過濾（只保留重要性 >= 6）
    const important = analyzer.filterByImportance(finalNews, 6);
    console.log(`🔍 最終保留：${important.length} 則（importance >= 6）`);
    
    // 儲存
    await analyzer.saveToFile(finalNews);
    
    console.log('✅ 新聞分析完成！');
  })();
}

module.exports = NewsAnalyzer;
