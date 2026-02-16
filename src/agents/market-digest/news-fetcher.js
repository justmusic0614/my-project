#!/usr/bin/env node
/**
 * news-fetcher.js
 * 抓取多來源財經新聞 RSS/JSON
 */

// 忽略 EPIPE 錯誤（當 stdout 管道提前關閉時）
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    process.exit(0);
  }
  throw err;
});

const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');

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
  supplement: [
    // 工商時報、鉅亨網、Investing.com RSS 解析失敗，暫時移除
    // 可改用其他來源或修復解析邏輯
  ]
};

// HTTP(S) 請求函數
function fetchUrl(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const timer = setTimeout(() => reject(new Error('Request timeout')), timeout);
    
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        resolve(data);
      });
    }).on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// 解析 RSS
async function parseRSS(xml) {
  try {
    const result = await parseStringPromise(xml, { trim: true, explicitArray: false });
    const items = result?.rss?.channel?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (err) {
    console.error('RSS parse error:', err.message);
    return [];
  }
}

// 提取新聞項目（統一格式）
function extractNewsItem(item, source) {
  const title = item.title?._cdata || item.title || '';
  const link = item.link || '';
  const pubDate = item.pubDate || '';
  const description = item.description?._cdata || item.description || '';
  
  return {
    source: source.name,
    sourceId: source.id,
    category: source.category,
    title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
    link: link.trim(),
    publishedAt: pubDate.trim(),  // 統一欄位名稱
    summary: description.replace(/<!\[CDATA\[|\]\]>|<[^>]*>/g, '').trim().substring(0, 200)  // 統一欄位名稱
  };
}

// 抓取單一來源
async function fetchSource(source) {
  try {
    console.log(`[Fetch] ${source.name}...`);
    const xml = await fetchUrl(source.url);
    const items = await parseRSS(xml);
    const news = items.slice(0, 10).map(item => extractNewsItem(item, source));
    console.log(`[OK] ${source.name}: ${news.length} articles`);
    return news;
  } catch (err) {
    console.error(`[FAIL] ${source.name}: ${err.message}`);
    return [];
  }
}

// 關鍵字白名單過濾
function filterByKeywords(newsList, keywords) {
  if (!keywords || keywords.length === 0) {
    return newsList;
  }

  const filtered = newsList.filter(news => {
    const text = `${news.title} ${news.summary}`.toLowerCase();
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
  });

  console.log(`🔍 關鍵字過濾：${filtered.length}/${newsList.length} 則保留`);
  return filtered;
}

// 去重（基於標題相似度）
function deduplicateNews(newsList, threshold = 0.8) {
  const deduplicated = [];
  const seen = new Set();

  for (const news of newsList) {
    const titleWords = news.title.toLowerCase().split(/\s+/);
    const key = titleWords.slice(0, 5).join('_'); // 前 5 個字當作去重鍵

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(news);
    }
  }

  if (deduplicated.length < newsList.length) {
    console.log(`🔁 去重：移除 ${newsList.length - deduplicated.length} 則重複新聞`);
  }

  return deduplicated;
}

// 主函數
async function fetchAllNews(options = {}) {
  console.log('=== 開始抓取財經新聞 ===\n');
  
  const { keywords = null, deduplicate = true, coreOnly = false } = options;
  
  const allSources = coreOnly ? NEWS_SOURCES.core : [...NEWS_SOURCES.core, ...NEWS_SOURCES.supplement];
  const results = await Promise.all(allSources.map(fetchSource));
  let allNews = results.flat();
  
  console.log(`\n=== 原始抓取：共 ${allNews.length} 則新聞 ===`);
  
  // 去重
  if (deduplicate) {
    allNews = deduplicateNews(allNews);
  }
  
  // 關鍵字過濾
  if (keywords && keywords.length > 0) {
    allNews = filterByKeywords(allNews, keywords);
  }
  
  console.log(`\n=== 最終結果：共 ${allNews.length} 則新聞 ===`);
  
  return {
    timestamp: new Date().toISOString(),
    total: allNews.length,
    sources: allSources.length,
    news: allNews
  };
}

// CLI 執行
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // 解析參數
  const options = {
    keywords: null,
    deduplicate: true,
    coreOnly: false
  };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keywords' && args[i + 1]) {
      options.keywords = args[i + 1].split(',');
      i++;
    } else if (args[i] === '--no-dedup') {
      options.deduplicate = false;
    } else if (args[i] === '--core-only') {
      options.coreOnly = true;
    }
  }
  
  fetchAllNews(options)
    .then(result => {
      console.log('\n=== 新聞摘要 ===');
      result.news.slice(0, 5).forEach((n, i) => {
        console.log(`${i + 1}. [${n.source}] ${n.title.substring(0, 60)}...`);
      });
      
      // 輸出 JSON
      const fs = require('fs');
      const outputPath = 'data/runtime/fetched-news.json';
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`\n已儲存至：${outputPath}`);
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}

module.exports = { fetchAllNews, NEWS_SOURCES, filterByKeywords, deduplicateNews };
