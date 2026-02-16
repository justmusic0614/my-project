/**
 * News Schema - 新聞資料標準格式
 * Version: 1.0
 */

const newsSchema = {
  version: '1.0',
  type: 'news-collection',
  
  // 容器結構
  container: {
    version: { type: 'string', required: true, example: '1.0' },
    timestamp: { type: 'string', format: 'iso8601', required: true },
    source: { type: 'string', required: true, example: 'market-digest' },
    date: { type: 'string', format: 'YYYY-MM-DD', required: false },
    count: { type: 'number', required: true },
    data: { type: 'array', items: 'newsItem', required: true }
  },
  
  // 新聞項目結構
  newsItem: {
    id: { type: 'string', required: false, description: 'UUID or hash' },
    title: { type: 'string', required: true, maxLength: 500 },
    source: { type: 'string', required: true, description: 'Source name' },
    sourceId: { type: 'string', required: true, description: 'Source identifier' },
    category: { 
      type: 'string', 
      required: true,
      enum: ['Taiwan_Market', 'Equity_Market', 'Forex', 'Commodity', 'General']
    },
    link: { type: 'string', format: 'url', required: true },
    pubDate: { type: 'string', format: 'iso8601', required: true },
    description: { type: 'string', required: false, maxLength: 2000 },
    importance: { 
      type: 'string', 
      required: false,
      enum: ['critical', 'high', 'medium', 'low']
    },
    keywords: { type: 'array', items: 'string', required: false },
    analyzed: { type: 'boolean', required: false, default: false }
  },
  
  // 範例資料
  example: {
    version: '1.0',
    timestamp: '2026-02-17T08:00:00Z',
    source: 'market-digest',
    date: '2026-02-17',
    count: 2,
    data: [
      {
        id: 'uuid-or-hash',
        title: '台積電Q4財報優於預期',
        source: 'Yahoo Finance 台股',
        sourceId: 'yahoo-tw',
        category: 'Taiwan_Market',
        link: 'https://example.com/news/1',
        pubDate: '2026-02-17T00:00:00Z',
        description: '台積電公布Q4財報...',
        importance: 'high',
        keywords: ['台積電', 'TSMC', '財報'],
        analyzed: false
      }
    ]
  }
};

module.exports = newsSchema;
