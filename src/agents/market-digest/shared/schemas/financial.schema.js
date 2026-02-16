/**
 * Financial Data Schema - 財報資料標準格式
 * Version: 1.0
 */

const financialSchema = {
  version: '1.0',
  type: 'financial-data',
  
  // 容器結構
  container: {
    version: { type: 'string', required: true, example: '1.0' },
    timestamp: { type: 'string', format: 'iso8601', required: true },
    source: { type: 'string', required: true },
    stockCode: { type: 'string', required: true },
    stock: { type: 'object', items: 'stockInfo', required: true },
    monthlyRevenue: { type: 'object', items: 'revenueData', required: false },
    quarterlyReport: { type: 'object', items: 'quarterlyData', required: false }
  },
  
  // 股票基本資料
  stockInfo: {
    code: { type: 'string', required: true },
    name: { type: 'string', required: true },
    industry: { type: 'string', required: false },
    type: { type: 'string', required: false, description: '上市/上櫃' }
  },
  
  // 月營收資料
  revenueData: {
    period: { type: 'string', required: true, example: '11501' },
    revenue: { type: 'number', required: true, description: '千元' },
    mom: { type: 'number', required: true, description: 'Month-over-Month %' },
    yoy: { type: 'number', required: true, description: 'Year-over-Year %' }
  },
  
  // 季度財報資料
  quarterlyData: {
    period: { type: 'string', required: true, example: '2026Q1' },
    eps: { type: 'number', required: true, description: '元' },
    revenue: { type: 'number', required: true, description: '千元' },
    profit: { type: 'number', required: true, description: '千元' },
    operatingIncome: { type: 'number', required: false, description: '千元' }
  },
  
  // 範例資料
  example: {
    version: '1.0',
    timestamp: '2026-02-17T08:00:00Z',
    source: 'market-digest',
    stockCode: '2330',
    stock: {
      code: '2330',
      name: '台灣積體電路製造股份有限公司',
      industry: '半導體業',
      type: '上市'
    },
    monthlyRevenue: {
      period: '11501',
      revenue: 238567000,
      mom: 5.2,
      yoy: 12.8
    },
    quarterlyReport: {
      period: '2025Q4',
      eps: 12.54,
      revenue: 750000000,
      profit: 295000000,
      operatingIncome: 315000000
    }
  }
};

module.exports = financialSchema;
