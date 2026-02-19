#!/usr/bin/env node
// Financial Data Fetcher - 財報數據抓取（E2） - REFACTORED
// 資料來源：公開資訊觀測站 API

const path = require('path');

// 使用 shared 層
const { fetchJSON } = require('./shared/http-client');
const { createLogger } = require('./shared/logger');
const CacheManager = require('./shared/cache-manager');

const logger = createLogger('financial-data-fetcher');
const cache = new CacheManager(
  path.join(__dirname, 'data/financial-cache'),
  { logger }
);

/**
 * 台灣公開資訊觀測站 API 端點
 */
const MOPS_API = {
  stockInfo: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
  monthlyRevenue: 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',
  quarterlyReport: 'https://openapi.twse.com.tw/v1/opendata/t187ap14_L',
  financialRatio: 'https://openapi.twse.com.tw/v1/opendata/t187ap06_L'
};

/**
 * 快取 TTL 設定
 */
const CACHE_TTL = {
  stockInfo: 86400000,      // 1 天
  monthlyRevenue: 3600000,  // 1 小時
  dividend: 86400000,       // 1 天
  financialRatio: 86400000  // 1 天
};

/**
 * 抓取資料（帶快取）
 */
async function fetchWithCache(url, cacheKey, ttl) {
  // 檢查快取
  const cached = cache.get(cacheKey, ttl);
  if (cached) {
    return cached;
  }
  
  // 抓取新資料
  logger.info(`正在抓取：${cacheKey}`);
  
  try {
    const data = await fetchJSON(url);
    cache.set(cacheKey, data, { pretty: true });
    return data;
  } catch (error) {
    logger.error(`無法取得 ${cacheKey}`, error);
    return null;
  }
}

/**
 * 取得股票基本資料
 */
async function getStockInfo(stockCode) {
  const cacheKey = `stock-info-${stockCode}`;
  const allStocks = await fetchWithCache(
    MOPS_API.stockInfo,
    'all-stocks',
    CACHE_TTL.stockInfo
  );
  
  if (!allStocks) {
    return null;
  }
  
  const stock = allStocks.find(s => s.公司代號 === stockCode);
  
  if (!stock) {
    logger.warn(`股票不存在：${stockCode}`);
    return null;
  }
  
  return {
    code: stock.公司代號,
    name: stock.公司名稱,
    industry: stock.產業類別 || 'N/A',
    type: stock.市場別 || 'N/A'
  };
}

/**
 * 取得月營收
 */
async function getMonthlyRevenue(stockCode) {
  const allRevenue = await fetchWithCache(
    MOPS_API.monthlyRevenue,
    'all-monthly-revenue',
    CACHE_TTL.monthlyRevenue
  );
  
  if (!allRevenue) {
    return null;
  }
  
  const revenue = allRevenue.filter(r => r.公司代號 === stockCode);
  
  if (revenue.length === 0) {
    logger.warn(`無月營收資料：${stockCode}`);
    return null;
  }
  
  // 取最新的營收資料
  const latest = revenue[0];
  
  return {
    period: `${latest.資料年月}`,
    revenue: parseFloat(latest.當月營收) || 0,
    mom: parseFloat(latest.上月比較增減) || 0,  // Month-over-month
    yoy: parseFloat(latest.去年同月增減) || 0   // Year-over-year
  };
}

/**
 * 取得季度財報（EPS）
 */
async function getQuarterlyReport(stockCode) {
  const allReports = await fetchWithCache(
    MOPS_API.quarterlyReport,
    'all-quarterly-reports',
    CACHE_TTL.financialRatio
  );
  
  if (!allReports) {
    return null;
  }
  
  const reports = allReports.filter(r => r.公司代號 === stockCode);
  
  if (reports.length === 0) {
    logger.warn(`無季度財報：${stockCode}`);
    return null;
  }
  
  // 取最新的季報
  const latest = reports[0];
  
  return {
    period: `${latest.年度}Q${latest.季別}`,
    eps: parseFloat(latest.基本每股盈餘) || 0,
    revenue: parseFloat(latest.營業收入) || 0,
    profit: parseFloat(latest.本期淨利) || 0
  };
}

/**
 * 取得完整財務資料
 */
async function getFinancialData(stockCode) {
  logger.info(`開始抓取財務資料：${stockCode}`);
  
  const [stockInfo, monthlyRevenue, quarterlyReport] = await Promise.all([
    getStockInfo(stockCode),
    getMonthlyRevenue(stockCode),
    getQuarterlyReport(stockCode)
  ]);
  
  if (!stockInfo) {
    logger.error(`股票不存在：${stockCode}`);
    return null;
  }
  
  const result = {
    stock: stockInfo,
    monthlyRevenue: monthlyRevenue || { period: 'N/A', revenue: 0, mom: 0, yoy: 0 },
    quarterlyReport: quarterlyReport || { period: 'N/A', eps: 0, revenue: 0, profit: 0 }
  };
  
  logger.success(`財務資料抓取完成：${stockCode}`);
  return result;
}

/**
 * 格式化財務資料（輸出）
 */
function formatFinancialData(data) {
  if (!data) return '無資料';
  
  const { stock, monthlyRevenue, quarterlyReport } = data;
  
  let output = [];
  output.push(`${stock.name} (${stock.code})`);
  output.push(`產業：${stock.industry}`);
  output.push('');
  output.push(`月營收 (${monthlyRevenue.period})：`);
  output.push(`  營收：${monthlyRevenue.revenue.toLocaleString()} 千元`);
  output.push(`  月增率：${monthlyRevenue.mom.toFixed(2)}%`);
  output.push(`  年增率：${monthlyRevenue.yoy.toFixed(2)}%`);
  output.push('');
  output.push(`季度財報 (${quarterlyReport.period})：`);
  output.push(`  EPS：${quarterlyReport.eps.toFixed(2)} 元`);
  output.push(`  營收：${(quarterlyReport.revenue / 1000000).toFixed(2)} 億元`);
  output.push(`  淨利：${(quarterlyReport.profit / 1000000).toFixed(2)} 億元`);
  
  return output.join('\n');
}

/**
 * 批次抓取多支股票
 */
async function batchFetch(stockCodes) {
  logger.info(`批次抓取 ${stockCodes.length} 支股票`);
  
  const results = await Promise.all(
    stockCodes.map(code => getFinancialData(code))
  );
  
  const successful = results.filter(r => r !== null);
  logger.success(`批次抓取完成`, { 
    total: stockCodes.length, 
    successful: successful.length 
  });
  
  return results;
}

/**
 * 主程式
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const stockCode = args[1];
  
  try {
    if (command === 'fetch' && stockCode) {
      const data = await getFinancialData(stockCode);
      if (data) {
        console.log(formatFinancialData(data));
      }
    } else if (command === 'batch' && stockCode) {
      const codes = stockCode.split(',');
      const results = await batchFetch(codes);
      results.forEach(data => {
        if (data) {
          console.log(formatFinancialData(data));
          console.log('---');
        }
      });
    } else if (command === 'clear-cache') {
      cache.clear();
    } else if (command === 'stats') {
      console.log('快取統計：', cache.getStats());
    } else {
      logger.info(`
Financial Data Fetcher - 財報數據抓取

指令：
  fetch <股票代號>         - 抓取單一股票
  batch <股票代號,股票代號>  - 批次抓取
  clear-cache            - 清除快取
  stats                  - 顯示統計

範例：
  node financial-data-fetcher.js fetch 2330
  node financial-data-fetcher.js batch 2330,2454,2412
      `);
    }
  } catch (err) {
    logger.error('主程式錯誤', err);
    process.exit(1);
  }
}

if (require.main === module) {
  console.error('⚠️  此腳本已廢棄，請使用統一入口：');
  console.error('    node index.js cmd <子命令>');
  console.error('    node index.js today');
  console.error('📖 完整說明：node index.js（無參數）');
  process.exit(1);
  main(); // 原始 CLI（已停用）
}

module.exports = {
  getFinancialData,
  getStockInfo,
  getMonthlyRevenue,
  getQuarterlyReport,
  batchFetch
};
