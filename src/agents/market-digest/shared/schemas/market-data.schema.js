/**
 * Market Data Schema - 市場資料標準格式
 * Version: 1.0
 */

const marketDataSchema = {
  version: '1.0',
  type: 'market-data',
  
  // 容器結構
  container: {
    version: { type: 'string', required: true, example: '1.0' },
    timestamp: { type: 'string', format: 'iso8601', required: true },
    date: { type: 'string', format: 'YYYY-MM-DD', required: true },
    source: { type: 'string', required: true },
    indices: { type: 'object', items: 'indexData', required: false },
    fx: { type: 'object', items: 'fxData', required: false },
    commodities: { type: 'object', items: 'commodityData', required: false },
    vix: { type: 'number', required: false }
  },
  
  // 指數資料
  indexData: {
    value: { type: 'number', required: true },
    change: { type: 'number', required: true },
    changePercent: { type: 'number', required: true },
    volume: { type: 'number', required: false, description: 'Volume in units' }
  },
  
  // 外匯資料
  fxData: {
    value: { type: 'number', required: true },
    change: { type: 'number', required: false },
    changePercent: { type: 'number', required: false }
  },
  
  // 商品資料
  commodityData: {
    value: { type: 'number', required: true },
    change: { type: 'number', required: false },
    changePercent: { type: 'number', required: false },
    unit: { type: 'string', required: false, example: 'USD/oz' }
  },
  
  // 範例資料
  example: {
    version: '1.0',
    timestamp: '2026-02-17T15:30:00Z',
    date: '2026-02-17',
    source: 'market-digest',
    indices: {
      twii: { 
        value: 32195.359, 
        change: -595.86, 
        changePercent: -1.85,
        volume: 5432.15
      },
      sp500: { 
        value: 6917.81, 
        change: -60.19, 
        changePercent: -0.87 
      },
      nasdaq: { 
        value: 19341.83, 
        change: -199.47, 
        changePercent: -1.02 
      },
      dow: { 
        value: 44424.25, 
        change: -696.75, 
        changePercent: -1.54 
      }
    },
    fx: {
      usdtwd: { 
        value: 31.58, 
        change: 0.47, 
        changePercent: 1.51 
      },
      dxy: { 
        value: 107.95, 
        change: 0.32, 
        changePercent: 0.30 
      }
    },
    commodities: {
      gold: { 
        value: 2975.50, 
        change: -12.30, 
        changePercent: -0.41,
        unit: 'USD/oz'
      },
      oil: { 
        value: 71.23, 
        change: -1.45, 
        changePercent: -2.00,
        unit: 'USD/bbl'
      }
    },
    vix: 16.85
  }
};

module.exports = marketDataSchema;
