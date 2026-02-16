/**
 * Watchlist Schema - 追蹤清單標準格式
 * Version: 1.0
 */

const watchlistSchema = {
  version: '1.0',
  type: 'watchlist',
  
  // 容器結構
  container: {
    version: { type: 'string', required: true, example: '1.0' },
    stocks: { type: 'array', items: 'stockItem', required: true },
    createdAt: { type: 'string', format: 'iso8601', required: true },
    updatedAt: { type: 'string', format: 'iso8601', required: true }
  },
  
  // 股票項目
  stockItem: {
    code: { type: 'string', required: true, pattern: '^[0-9]{4}$' },
    name: { type: 'string', required: true },
    addedAt: { type: 'string', format: 'iso8601', required: true },
    tags: { type: 'array', items: 'string', required: false },
    notes: { type: 'string', required: false, maxLength: 500 }
  },
  
  // 範例資料
  example: {
    version: '1.0',
    stocks: [
      {
        code: '2330',
        name: '台積電',
        addedAt: '2026-02-03T00:24:52.147Z',
        tags: ['半導體', '權值股'],
        notes: 'AI 晶片需求強勁'
      },
      {
        code: '2454',
        name: '聯發科',
        addedAt: '2026-02-03T00:24:52.153Z',
        tags: ['IC設計'],
        notes: ''
      }
    ],
    createdAt: '2026-02-03T00:24:52.146Z',
    updatedAt: '2026-02-17T08:00:00.000Z'
  }
};

module.exports = watchlistSchema;
