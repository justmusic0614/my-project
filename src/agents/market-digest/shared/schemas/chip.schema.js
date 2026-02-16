/**
 * Chip Data Schema - 籌碼資料標準格式
 * Version: 1.0
 */

const chipSchema = {
  version: '1.0',
  type: 'chip-data',
  
  // 容器結構
  container: {
    version: { type: 'string', required: true, example: '1.0' },
    timestamp: { type: 'string', format: 'iso8601', required: true },
    date: { type: 'string', format: 'YYYY-MM-DD', required: true },
    source: { type: 'string', required: true },
    stockCode: { type: 'string', required: true },
    stock: { type: 'object', items: 'stockBasic', required: true },
    margin: { type: 'object', items: 'marginData', required: false },
    institutional: { type: 'object', items: 'institutionalData', required: false }
  },
  
  // 股票基本資料
  stockBasic: {
    code: { type: 'string', required: true },
    name: { type: 'string', required: true },
    volume: { type: 'number', required: false, description: '成交量（股）' },
    value: { type: 'number', required: false, description: '成交值（元）' },
    closingPrice: { type: 'number', required: false },
    change: { type: 'number', required: false }
  },
  
  // 融資融券資料
  marginData: {
    marginPurchase: { type: 'number', required: true, description: '融資買進（張）' },
    marginSale: { type: 'number', required: true, description: '融資賣出（張）' },
    marginBalance: { type: 'number', required: true, description: '融資餘額（張）' },
    shortSale: { type: 'number', required: true, description: '融券賣出（張）' },
    shortCover: { type: 'number', required: true, description: '融券買進（張）' },
    shortBalance: { type: 'number', required: true, description: '融券餘額（張）' }
  },
  
  // 三大法人資料
  institutionalData: {
    foreign: { type: 'number', required: true, description: '外資買賣超（張）' },
    investment: { type: 'number', required: true, description: '投信買賣超（張）' },
    dealer: { type: 'number', required: true, description: '自營商買賣超（張）' },
    total: { type: 'number', required: true, description: '合計（張）' }
  },
  
  // 範例資料
  example: {
    version: '1.0',
    timestamp: '2026-02-17T16:00:00Z',
    date: '2026-02-17',
    source: 'market-digest',
    stockCode: '2330',
    stock: {
      code: '2330',
      name: '台積電',
      volume: 45230000,
      value: 86500000000,
      closingPrice: 1915,
      change: -35
    },
    margin: {
      marginPurchase: 1234,
      marginSale: 987,
      marginBalance: 15678,
      shortSale: 456,
      shortCover: 234,
      shortBalance: 2345
    },
    institutional: {
      foreign: 12500,
      investment: -345,
      dealer: 567,
      total: 12722
    }
  }
};

module.exports = chipSchema;
