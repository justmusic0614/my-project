#!/usr/bin/env node
/**
 * news-fetcher.js (REFACTORED)
 * 抓取多來源財經新聞 RSS/JSON
 * 
 * 重構：使用 shared/http-client.js 和 shared/logger.js
 */

// 忽略 EPIPE 錯誤
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const { parseStringPromise } = require('xml2js');
const fs = require('fs');
const path = require('path');

// 使用 shared 層
const { fetchText } = require('./shared/http-client');
const { createLogger } = require('./shared/logger');
const Deduplicator = require('./shared/deduplicator');

const logger = createLogger('news-fetcher');

// 新聞來源設定
const NEWS_SOURCES = {
  core: [
    {
      id: 'yahoo-tw',
      name: 'Yahoo Finance 台股',
      url: 'https://tw.stock.yahoo.com/rss?category=tw-market',
      type: 'rss',
      category: 'Taiwan_Market'
    },
    {
      id: 'cnbc-business',
      name: 'CNBC Business News',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147',
      type: 'rss',
      category: 'Equity_Market'
    },
    {
      id: 'cnbc-investing',
      name: 'CNBC Markets',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069',
      type: 'rss',
      category: 'Equity_Market'
    },
    {
      id: 'udn-business',
      name: '經濟日報',
      url: 'https://money.udn.com/rssfeed/news/1001/5591/latest',
      type: 'rss',
      category: 'Taiwan_Market'
    }
  ],
  supplement: []
};

// 解析 RSS
async function parseRSS(xml) {
  try {
    const result = await parseStringPromise(xml, { trim: true, explicitArray: false });
    const items = result.rss?.channel?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (err) {
    logger.error('RSS parse error', err);
    return [];
  }
}

// 抓取單一來源
async function fetchSource(source) {
  try {
    logger.info(`開始抓取：${source.name}`);
    
    // 使用 http-client（包含超時和重試）
    const data = await fetchText(source.url);
    const items = await parseRSS(data);
    
    const news = items.map(item => ({
      title: item.title || '',
      source: source.name,
      sourceId: source.id,
      category: source.category,
      link: item.link || '',
      pubDate: item.pubDate || new Date().toISOString(),
      description: item.description || ''
    }));
    
    logger.success(`抓取成功：${source.name}`, { count: news.length });
    return news;
    
  } catch (err) {
    logger.error(`抓取失敗：${source.name}`, err);
    return [];
  }
}

// 關鍵字過濾
function filterByKeywords(newsList, config = {}) {
  const keywords = config.keywords || ['台積電', 'TSMC', '外資', '台股', '美股', 'Fed', 'AI'];
  
  const filtered = newsList.filter(news => {
    const text = `${news.title} ${news.description}`.toLowerCase();
    return keywords.some(kw => text.includes(kw.toLowerCase()));
  });
  
  logger.info('關鍵字過濾', { 
    original: newsList.length, 
    filtered: filtered.length 
  });
  
  return filtered;
}

// 主要抓取函數
async function fetchAll(options = {}) {
  logger.info('=== 開始抓取財經新聞 ===');
  
  const sources = [...NEWS_SOURCES.core, ...NEWS_SOURCES.supplement];
  const results = await Promise.all(sources.map(fetchSource));
  let allNews = results.flat();
  
  logger.info('原始抓取完成', { count: allNews.length });
  
  // 關鍵字過濾
  if (options.filterKeywords !== false) {
    allNews = filterByKeywords(allNews, options);
  }
  
  // 去重
  if (options.deduplicate !== false) {
    const deduplicator = new Deduplicator({
      algorithm: 'jaccard',
      threshold: 0.85
    });
    
    const result = deduplicator.deduplicate(allNews.map(n => n.title));
    const uniqueTitles = new Set(result.unique);
    allNews = allNews.filter(n => uniqueTitles.has(n.title));
    
    logger.info('去重完成', result.stats);
  }
  
  logger.success('=== 最終結果 ===', { count: allNews.length });
  
  return allNews;
}

// 主程式
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  try {
    if (command === 'fetch') {
      const news = await fetchAll();
      
      // 顯示摘要
      if (news.length > 0) {
        logger.info('=== 新聞摘要 ===');
        news.slice(0, 10).forEach((n, i) => {
          logger.info(`${i + 1}. [${n.source}] ${n.title.substring(0, 60)}...`);
        });
      }
      
      // 儲存到檔案
      const today = new Date().toISOString().split('T')[0];
      const outputDir = path.join(__dirname, 'data/news-collect');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const outputPath = path.join(outputDir, `${today}.json`);
      fs.writeFileSync(outputPath, JSON.stringify({ 
        version: '1.0',
        timestamp: new Date().toISOString(),
        source: 'market-digest',
        count: news.length,
        data: news 
      }, null, 2));
      
      logger.success('已儲存', { path: outputPath });
      
    } else {
      logger.info('使用方法：node news-fetcher.js fetch');
    }
  } catch (err) {
    logger.error('主程式錯誤', err);
    process.exit(1);
  }
}

// 如果直接執行
if (require.main === module) {
  main();
}

module.exports = { fetchAll, fetchSource };
