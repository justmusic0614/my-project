#!/usr/bin/env node
// Chip Data Fetcher - 籌碼面數據抓取（E3）
// 資料來源：台灣證券交易所 OpenAPI

const fs = require('fs');
const path = require('path');

/**
 * 證交所 API 端點（研究中）
 * 
 * 已知可用：
 * - STOCK_DAY_ALL：每日收盤行情
 * 
 * 待研究：
 * - 三大法人買賣超
 * - 融資融券餘額
 * - 借券餘額
 */
const TWSE_API = {
  // 每日收盤行情
  dailyTrade: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  
  // 融資融券
  marginTrading: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN',
  
  // 三大法人買賣超（需要動態日期）
  institutionalInvestors: (date) => `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`,
  
  // 待補充
  // borrowing: 'TBD'
};

/**
 * 快取設定
 */
const CACHE_DIR = path.join(__dirname, 'data/chip-cache');
const CACHE_TTL = {
  dailyTrade: 3600000,  // 1 小時
  chipData: 3600000      // 1 小時
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
 * 取得每日交易資料（含成交量、成交值）
 */
async function getDailyTrade(stockCode) {
  const data = await fetchWithCache(
    TWSE_API.dailyTrade,
    'daily-trade-all',
    CACHE_TTL.dailyTrade
  );
  
  if (!data) return null;
  
  // 找出指定股票
  const stock = data.find(s => s['Code'] === stockCode);
  
  if (!stock) {
    console.log(`⚠️  找不到股票：${stockCode}`);
    return null;
  }
  
  return {
    code: stockCode,
    name: stock['Name'],
    date: stock['Date'],
    closingPrice: parseFloat(stock['ClosingPrice']),
    change: parseFloat(stock['Change']),
    tradeVolume: parseInt(stock['TradeVolume']),
    tradeValue: parseInt(stock['TradeValue']),
    transaction: parseInt(stock['Transaction']),
    openingPrice: parseFloat(stock['OpeningPrice']),
    highestPrice: parseFloat(stock['HighestPrice']),
    lowestPrice: parseFloat(stock['LowestPrice'])
  };
}

/**
 * 取得融資融券資料
 */
async function getMarginTrading(stockCode) {
  const data = await fetchWithCache(
    TWSE_API.marginTrading,
    'margin-trading-all',
    CACHE_TTL.chipData
  );
  
  if (!data) return null;
  
  // 找出指定股票
  const stock = data.find(s => s['股票代號'] === stockCode);
  
  if (!stock) {
    console.log(`⚠️  找不到融資融券資料：${stockCode}`);
    return null;
  }
  
  return {
    code: stockCode,
    name: stock['股票名稱'],
    // 融資
    marginBuy: parseInt(stock['融資買進']) || 0,
    marginSell: parseInt(stock['融資賣出']) || 0,
    marginRepay: parseInt(stock['融資現金償還']) || 0,
    marginBalancePrev: parseInt(stock['融資前日餘額']) || 0,
    marginBalanceToday: parseInt(stock['融資今日餘額']) || 0,
    marginLimit: parseInt(stock['融資限額']) || 0,
    // 融券
    shortBuy: parseInt(stock['融券買進']) || 0,
    shortSell: parseInt(stock['融券賣出']) || 0,
    shortRepay: parseInt(stock['融券現券償還']) || 0,
    shortBalancePrev: parseInt(stock['融券前日餘額']) || 0,
    shortBalanceToday: parseInt(stock['融券今日餘額']) || 0,
    shortLimit: parseInt(stock['融券限額']) || 0,
    // 資券互抵
    offsetShares: parseInt(stock['資券互抵']) || 0
  };
}

/**
 * 取得三大法人買賣超
 */
async function getInstitutionalInvestors(stockCode) {
  // 取得今天日期（西元年格式：YYYYMMDD）
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const url = TWSE_API.institutionalInvestors(dateStr);
  const cacheKey = `institutional-${dateStr}`;
  
  const data = await fetchWithCache(url, cacheKey, CACHE_TTL.chipData);
  
  if (!data || !data.data) {
    console.log(`⚠️  找不到三大法人資料（日期：${dateStr}）`);
    return null;
  }
  
  // 找出指定股票
  // data.data 格式：[[證券代號, 證券名稱, ...], ...]
  // fields: [0]證券代號, [4]外資買賣超, [10]投信買賣超, [11]自營商買賣超, [18]三大法人買賣超
  const stock = data.data.find(row => row[0] === stockCode);
  
  if (!stock) {
    console.log(`⚠️  找不到 ${stockCode} 的三大法人資料`);
    return null;
  }
  
  // 解析數字（移除千分位逗號）
  const parseNum = (str) => {
    if (!str || str === '--') return 0;
    return parseInt(str.toString().replace(/,/g, ''));
  };
  
  return {
    code: stockCode,
    name: stock[1].trim(),
    date: dateStr,
    // 外資（不含外資自營商）
    foreign: parseNum(stock[4]),
    // 投信
    trust: parseNum(stock[10]),
    // 自營商（合計）
    dealer: parseNum(stock[11]),
    // 三大法人合計
    total: parseNum(stock[18])
  };
}

/**
 * 取得籌碼面數據（整合）
 * 
 * Phase 1：基本交易資料 ✅
 * Phase 2：融資融券 ✅
 * Phase 3：三大法人 ✅
 */
async function getChipData(stockCode) {
  console.log(`\n📊 正在抓取 ${stockCode} 的籌碼面數據...`);
  console.log('━━━━━━━━━━━━━━━━━━\n');
  
  const [dailyTrade, marginTrading, institutional] = await Promise.all([
    getDailyTrade(stockCode),
    getMarginTrading(stockCode),
    getInstitutionalInvestors(stockCode)
  ]);
  
  if (!dailyTrade) {
    console.error(`❌ 無法取得 ${stockCode} 的交易資料`);
    return null;
  }
  
  return {
    stock: {
      code: stockCode,
      name: dailyTrade.name
    },
    dailyTrade: dailyTrade,
    marginTrading: marginTrading,
    institutionalInvestors: institutional,
    updatedAt: new Date().toISOString()
  };
}

/**
 * 格式化籌碼面輸出
 */
function formatChipData(data) {
  if (!data) return '❌ 無籌碼面資料';
  
  const lines = [];
  
  lines.push(`📊 ${data.stock.code} ${data.stock.name}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 每日交易資料
  if (data.dailyTrade) {
    const t = data.dailyTrade;
    const dateStr = `${t.date.substring(0, 3)}年${t.date.substring(3, 5)}月${t.date.substring(5, 7)}日`;
    
    lines.push(`💹 交易資料（民國${dateStr}）`);
    lines.push(`  • 收盤價：${t.closingPrice} 元（${t.change > 0 ? '▲' : '▼'} ${Math.abs(t.change)}）`);
    lines.push(`  • 成交量：${(t.tradeVolume / 1000).toFixed(0)} 張`);
    lines.push(`  • 成交值：${(t.tradeValue / 100000000).toFixed(2)} 億`);
    lines.push(`  • 成交筆數：${t.transaction.toLocaleString()} 筆`);
    lines.push(`  • 開盤：${t.openingPrice} | 最高：${t.highestPrice} | 最低：${t.lowestPrice}`);
    lines.push('');
  }
  
  // 融資融券
  if (data.marginTrading) {
    const m = data.marginTrading;
    const marginChange = m.marginBalanceToday - m.marginBalancePrev;
    const shortChange = m.shortBalanceToday - m.shortBalancePrev;
    const marginUsage = m.marginLimit > 0 ? (m.marginBalanceToday / m.marginLimit * 100).toFixed(2) : 0;
    
    lines.push(`💰 融資融券`);
    lines.push(`  • 融資餘額：${m.marginBalanceToday.toLocaleString()} 張（${marginChange >= 0 ? '▲' : '▼'} ${Math.abs(marginChange).toLocaleString()}）`);
    lines.push(`  • 融資使用率：${marginUsage}%`);
    lines.push(`  • 融券餘額：${m.shortBalanceToday.toLocaleString()} 張（${shortChange >= 0 ? '▲' : '▼'} ${Math.abs(shortChange).toLocaleString()}）`);
    if (m.offsetShares > 0) {
      lines.push(`  • 資券互抵：${m.offsetShares.toLocaleString()} 張`);
    }
    lines.push('');
  }
  
  // 三大法人
  if (data.institutionalInvestors) {
    const ii = data.institutionalInvestors;
    const formatShares = (num) => {
      const absNum = Math.abs(num);
      const sign = num >= 0 ? '▲' : '▼';
      return `${sign} ${(absNum / 1000).toFixed(0)} 張`;
    };
    
    lines.push(`📌 三大法人買賣超`);
    lines.push(`  • 外資：${formatShares(ii.foreign)}`);
    lines.push(`  • 投信：${formatShares(ii.trust)}`);
    lines.push(`  • 自營商：${formatShares(ii.dealer)}`);
    lines.push(`  • 合計：${formatShares(ii.total)}`);
    lines.push('');
  } else {
    lines.push(`📌 三大法人買賣超`);
    lines.push(`  • ⚠️  今日資料尚未公佈`);
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
    const data = await getChipData(code);
    if (data) {
      results.push(data);
    }
    
    // 禮貌間隔
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
      console.error('💡 使用：node chip-data-fetcher.js fetch 2330');
      process.exit(1);
    }
    
    (async () => {
      const data = await getChipData(stockCode);
      console.log('\n' + formatChipData(data));
    })();
    
  } else if (command === 'batch') {
    const codes = process.argv.slice(3);
    
    if (codes.length === 0) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node chip-data-fetcher.js batch 2330 2454 2408');
      process.exit(1);
    }
    
    (async () => {
      const results = await batchFetch(codes);
      
      console.log('\n━━━━━━━━━━━━━━━━━━');
      console.log(`✅ 完成抓取 ${results.length} 檔`);
      console.log('━━━━━━━━━━━━━━━━━━\n');
      
      results.forEach(data => {
        console.log(formatChipData(data));
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
Chip Data Fetcher - 籌碼面數據抓取

指令：
  fetch <股票代號>             抓取單檔股票籌碼面
  batch <代號...>             批次抓取多檔股票
  clear-cache                清除快取

範例：
  node chip-data-fetcher.js fetch 2330
  node chip-data-fetcher.js batch 2330 2454 2408
  node chip-data-fetcher.js clear-cache

資料來源：
  • 台灣證券交易所 OpenAPI
  
目前狀態：
  ✅ 每日交易資料（收盤價、成交量、成交值）
  ✅ 融資融券（融資/融券餘額、使用率）
  ✅ 三大法人（外資/投信/自營商買賣超）
  ⏳ 借券餘額（待補充 API）

E3 實作進度：Phase 3/3 ✅
    `);
  }
}

module.exports = {
  getDailyTrade,
  getMarginTrading,
  getInstitutionalInvestors,
  getChipData,
  formatChipData,
  batchFetch
};
