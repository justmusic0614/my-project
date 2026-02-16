#!/usr/bin/env node
// Financial Data Fetcher - 財報數據抓取（E2）
// 資料來源：公開資訊觀測站 API

const fs = require('fs');
const path = require('path');

/**
 * 台灣公開資訊觀測站 API 端點
 * https://openapi.twse.com.tw/
 */
const MOPS_API = {
  // 上市公司基本資料
  stockInfo: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
  
  // 月營收（最新）
  monthlyRevenue: 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',
  
  // 季度財報（EPS）
  quarterlyReport: 'https://openapi.twse.com.tw/v1/opendata/t187ap14_L',
  
  // 財務比率（季）- 需要從證交所另外取得
  financialRatio: 'https://openapi.twse.com.tw/v1/opendata/t187ap06_L'
};

/**
 * 快取設定
 */
const CACHE_DIR = path.join(__dirname, 'data/financial-cache');
const CACHE_TTL = {
  stockInfo: 86400000,      // 1 天
  monthlyRevenue: 3600000,  // 1 小時
  dividend: 86400000,       // 1 天
  financialRatio: 86400000  // 1 天
};

/**
 * 確保快取目錄存在
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * 讀取快取
 */
function readCache(key, ttl) {
  ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  
  const stat = fs.statSync(cachePath);
  const age = Date.now() - stat.mtimeMs;
  
  if (age > ttl) {
    console.log(`⏰ 快取過期：${key}（${Math.floor(age / 60000)} 分鐘前）`);
    return null;
  }
  
  console.log(`✅ 使用快取：${key}`);
  return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

/**
 * 寫入快取
 */
function writeCache(key, data) {
  ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
  console.log(`💾 已快取：${key}`);
}

/**
 * 抓取資料（帶快取）
 */
async function fetchWithCache(url, cacheKey, ttl) {
  // 檢查快取
  const cached = readCache(cacheKey, ttl);
  if (cached) {
    return cached;
  }
  
  // 抓取新資料
  console.log(`🌐 正在抓取：${cacheKey}...`);
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // 寫入快取
    writeCache(cacheKey, data);
    
    return data;
    
  } catch (err) {
    console.error(`❌ 抓取失敗：${cacheKey}`);
    console.error(err.message);
    return null;
  }
}

/**
 * 取得股票基本資料
 */
async function getStockInfo(stockCode) {
  const data = await fetchWithCache(
    MOPS_API.stockInfo,
    'stock-info-all',
    CACHE_TTL.stockInfo
  );
  
  if (!data) return null;
  
  // 找出指定股票
  const stock = data.find(s => s['公司代號'] === stockCode);
  
  if (!stock) {
    console.log(`⚠️  找不到股票：${stockCode}`);
    return null;
  }
  
  return {
    code: stock['公司代號'],
    name: stock['公司名稱'],
    industry: stock['產業別'],
    chairman: stock['董事長'],
    ceo: stock['總經理']
  };
}

/**
 * 取得月營收資料
 */
async function getMonthlyRevenue(stockCode) {
  const data = await fetchWithCache(
    MOPS_API.monthlyRevenue,
    'monthly-revenue-all',
    CACHE_TTL.monthlyRevenue
  );
  
  if (!data) return null;
  
  // 找出指定股票的營收資料
  const revenues = data.filter(r => r['公司代號'] === stockCode);
  
  if (revenues.length === 0) {
    console.log(`⚠️  找不到營收資料：${stockCode}`);
    return null;
  }
  
  // 取最新一筆
  const latest = revenues[0];
  
  return {
    code: stockCode,
    year: latest['資料年月'].substring(0, 3),
    month: latest['資料年月'].substring(3),
    revenue: parseFloat(latest['營業收入-當月營收']),
    revenuePrev: parseFloat(latest['營業收入-上月營收']),
    revenueYoY: parseFloat(latest['營業收入-去年同月增減(%)']),
    revenueMoM: parseFloat(latest['營業收入-上月比較增減(%)']),
    累計營收: parseFloat(latest['累計營業收入-當月累計營收']),
    累計營收YoY: parseFloat(latest['累計營業收入-前期比較增減(%)'])
  };
}

/**
 * 取得季度財報資料（EPS）
 */
async function getQuarterlyReport(stockCode) {
  const data = await fetchWithCache(
    MOPS_API.quarterlyReport,
    'quarterly-report-all',
    CACHE_TTL.dividend
  );
  
  if (!data) return null;
  
  // 找出指定股票的財報資料
  const reports = data.filter(r => r['公司代號'] === stockCode);
  
  if (reports.length === 0) {
    console.log(`⚠️  找不到季度財報：${stockCode}`);
    return null;
  }
  
  // 取最新季度
  const latest = reports[0];
  
  return {
    code: stockCode,
    year: latest['年度'],
    quarter: latest['季別'],
    eps: parseFloat(latest['基本每股盈餘(元)']),
    revenue: parseFloat(latest['營業收入']),
    operatingIncome: parseFloat(latest['營業利益']),
    netIncome: parseFloat(latest['稅後淨利']),
    profitMargin: ((parseFloat(latest['稅後淨利']) / parseFloat(latest['營業收入'])) * 100).toFixed(2)
  };
}

/**
 * 取得完整財報數據（整合）
 */
async function getFinancialData(stockCode) {
  console.log(`\n📊 正在抓取 ${stockCode} 的財報數據...`);
  console.log('━━━━━━━━━━━━━━━━━━\n');
  
  const [stockInfo, revenue, quarterly] = await Promise.all([
    getStockInfo(stockCode),
    getMonthlyRevenue(stockCode),
    getQuarterlyReport(stockCode)
  ]);
  
  if (!stockInfo) {
    console.error(`❌ 無法取得 ${stockCode} 的基本資料`);
    return null;
  }
  
  return {
    stock: stockInfo,
    revenue: revenue,
    quarterly: quarterly,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 格式化財報輸出
 */
function formatFinancialData(data) {
  if (!data) return '❌ 無財報資料';
  
  const lines = [];
  
  lines.push(`📊 ${data.stock.code} ${data.stock.name}`);
  lines.push(`🏢 產業：${data.stock.industry}`);
  lines.push(`👤 董事長：${data.stock.chairman} | 總經理：${data.stock.ceo}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 營收資料
  if (data.revenue) {
    const r = data.revenue;
    lines.push(`💰 營收（民國${r.year}年${r.month}月）`);
    lines.push(`  • 當月營收：${(r.revenue / 1000000).toFixed(2)} 億`);
    lines.push(`  • 月增率：${r.revenueMoM > 0 ? '▲' : '▼'} ${Math.abs(r.revenueMoM).toFixed(2)}%`);
    lines.push(`  • 年增率：${r.revenueYoY > 0 ? '▲' : '▼'} ${Math.abs(r.revenueYoY).toFixed(2)}%`);
    lines.push(`  • 累計營收：${(r.累計營收 / 1000000).toFixed(2)} 億（YoY ${r.累計營收YoY > 0 ? '+' : ''}${r.累計營收YoY.toFixed(2)}%）`);
    lines.push('');
  }
  
  // 季度財報資料
  if (data.quarterly) {
    const q = data.quarterly;
    lines.push(`📊 財報（民國${q.year}年Q${q.quarter}）`);
    lines.push(`  • EPS：${q.eps} 元`);
    lines.push(`  • 營業收入：${(q.revenue / 1000000).toFixed(2)} 億`);
    lines.push(`  • 營業利益：${(q.operatingIncome / 1000000).toFixed(2)} 億`);
    lines.push(`  • 稅後淨利：${(q.netIncome / 1000000).toFixed(2)} 億`);
    lines.push(`  • 淨利率：${q.profitMargin}%`);
    lines.push('');
  }
  
  lines.push(`🕒 更新時間：${new Date(data.updatedAt).toLocaleString('zh-TW')}`);
  
  return lines.join('\n');
}

/**
 * 批次抓取多檔股票
 */
async function batchFetch(stockCodes) {
  console.log(`🔄 批次抓取 ${stockCodes.length} 檔股票...\n`);
  
  const results = [];
  
  for (const code of stockCodes) {
    const data = await getFinancialData(code);
    if (data) {
      results.push(data);
    }
    
    // 避免請求過快（禮貌間隔）
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'fetch') {
    const stockCode = process.argv[3];
    
    if (!stockCode) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node financial-data-fetcher.js fetch 2330');
      process.exit(1);
    }
    
    (async () => {
      const data = await getFinancialData(stockCode);
      console.log('\n' + formatFinancialData(data));
    })();
    
  } else if (command === 'batch') {
    const codes = process.argv.slice(3);
    
    if (codes.length === 0) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node financial-data-fetcher.js batch 2330 2454 2408');
      process.exit(1);
    }
    
    (async () => {
      const results = await batchFetch(codes);
      
      console.log('\n━━━━━━━━━━━━━━━━━━');
      console.log(`✅ 完成抓取 ${results.length} 檔`);
      console.log('━━━━━━━━━━━━━━━━━━\n');
      
      results.forEach(data => {
        console.log(formatFinancialData(data));
        console.log('');
      });
    })();
    
  } else if (command === 'clear-cache') {
    console.log('🗑️  清除快取...');
    if (fs.existsSync(CACHE_DIR)) {
      fs.rmSync(CACHE_DIR, { recursive: true });
      console.log('✅ 快取已清除');
    } else {
      console.log('⚠️  快取目錄不存在');
    }
    
  } else {
    console.log(`
Financial Data Fetcher - 財報數據抓取

指令：
  fetch <股票代號>             抓取單檔股票財報
  batch <代號...>             批次抓取多檔股票
  clear-cache                清除快取

範例：
  node financial-data-fetcher.js fetch 2330
  node financial-data-fetcher.js batch 2330 2454 2408
  node financial-data-fetcher.js clear-cache

資料來源：
  • 台灣證券交易所 OpenAPI
  • 公開資訊觀測站
  
快取設定：
  • 股票基本資料：1 天
  • 月營收：1 小時
  • 除權息：1 天
    `);
  }
}

module.exports = {
  getStockInfo,
  getMonthlyRevenue,
  getQuarterlyReport,
  getFinancialData,
  formatFinancialData,
  batchFetch
};
