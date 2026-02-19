#!/usr/bin/env node
// Chip Data Fetcher - 籌碼面數據抓取（E3） - REFACTORED
// 資料來源：台灣證券交易所 OpenAPI

const path = require('path');

// 使用 shared 層
const { fetchJSON } = require('./shared/http-client');
const { createLogger } = require('./shared/logger');
const CacheManager = require('./shared/cache-manager');

const logger = createLogger('chip-data-fetcher');
const cache = new CacheManager(
  path.join(__dirname, 'data/chip-cache'),
  { logger }
);

/**
 * 證交所 API 端點
 */
const TWSE_API = {
  dailyTrade: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  marginTrading: 'https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN',
  institutionalInvestors: (date) => `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALLBUT0999&response=json`
};

/**
 * 快取 TTL 設定
 */
const CACHE_TTL = {
  dailyTrade: 3600000,  // 1 小時
  chipData: 3600000      // 1 小時
};

/**
 * 抓取資料（帶快取）
 */
async function fetchWithCache(url, cacheKey, ttl) {
  const cached = cache.get(cacheKey, ttl);
  if (cached) return cached;
  
  logger.info(`正在抓取：${cacheKey}`);
  
  try {
    const data = await fetchJSON(url);
    cache.set(cacheKey, data, { pretty: true });
    return data;
  } catch (err) {
    logger.error(`抓取失敗：${cacheKey}`, err);
    return null;
  }
}

/**
 * 取得每日交易資料
 */
async function getDailyTrade(stockCode) {
  const allTrades = await fetchWithCache(
    TWSE_API.dailyTrade,
    'daily-trade-all',
    CACHE_TTL.dailyTrade
  );
  
  if (!allTrades) return null;
  
  const trade = allTrades.find(t => t.Code === stockCode);
  
  if (!trade) {
    logger.warn(`無交易資料：${stockCode}`);
    return null;
  }
  
  return {
    code: trade.Code,
    name: trade.Name,
    volume: parseInt(trade.TradeVolume?.replace(/,/g, '') || 0),
    value: parseFloat(trade.TradeValue?.replace(/,/g, '') || 0),
    closingPrice: parseFloat(trade.ClosingPrice || 0),
    change: parseFloat(trade.Change || 0)
  };
}

/**
 * 取得融資融券資料
 */
async function getMarginTrading(stockCode) {
  const allMargin = await fetchWithCache(
    TWSE_API.marginTrading,
    'margin-trading-all',
    CACHE_TTL.chipData
  );
  
  if (!allMargin) return null;
  
  const margin = allMargin.find(m => m.Code === stockCode || m.股票代號 === stockCode);
  
  if (!margin) {
    logger.warn(`無融資融券資料：${stockCode}`);
    return null;
  }
  
  return {
    marginPurchase: parseInt(margin.融資買進?.replace(/,/g, '') || 0),
    marginSale: parseInt(margin.融資賣出?.replace(/,/g, '') || 0),
    marginBalance: parseInt((margin.融資今日餘額 || margin.融資餘額)?.replace(/,/g, '') || 0),
    marginBalanceToday: parseInt((margin.融資今日餘額 || margin.融資餘額)?.replace(/,/g, '') || 0),
    marginBalancePrev: parseInt(margin.融資前日餘額?.replace(/,/g, '') || 0),
    marginLimit: parseInt(margin.融資限額?.replace(/,/g, '') || 0),
    shortSale: parseInt(margin.融券賣出?.replace(/,/g, '') || 0),
    shortCover: parseInt(margin.融券買進?.replace(/,/g, '') || 0),
    shortBalance: parseInt((margin.融券今日餘額 || margin.融券餘額)?.replace(/,/g, '') || 0),
    shortBalanceToday: parseInt((margin.融券今日餘額 || margin.融券餘額)?.replace(/,/g, '') || 0),
    shortBalancePrev: parseInt(margin.融券前日餘額?.replace(/,/g, '') || 0)
  };
}

/**
 * 取得三大法人買賣超
 */
async function getInstitutionalInvestors(stockCode, date = null) {
  const today = date || new Date().toISOString().split('T')[0].replace(/-/g, '');
  const cacheKey = `institutional-${today}`;
  
  const data = await fetchWithCache(
    TWSE_API.institutionalInvestors(today),
    cacheKey,
    CACHE_TTL.chipData
  );
  
  if (!data || !data.data) return null;
  
  const record = data.data.find(r => r[0] === stockCode);
  
  if (!record) {
    logger.warn(`無法人買賣資料：${stockCode}`);
    return null;
  }
  
  return {
    foreign: parseInt(record[4]?.replace(/,/g, '') || 0),
    trust: parseInt(record[10]?.replace(/,/g, '') || 0),
    investment: parseInt(record[10]?.replace(/,/g, '') || 0),
    dealer: parseInt(record[11]?.replace(/,/g, '') || 0),
    total: parseInt(record[18]?.replace(/,/g, '') || 0)
  };
}

/**
 * 取得完整籌碼面資料
 */
async function getChipData(stockCode, date = null) {
  logger.info(`開始抓取籌碼資料：${stockCode}`);
  
  const [dailyTrade, margin, institutional] = await Promise.all([
    getDailyTrade(stockCode),
    getMarginTrading(stockCode),
    getInstitutionalInvestors(stockCode, date)
  ]);
  
  if (!dailyTrade) {
    logger.error(`無基本交易資料：${stockCode}`);
    return null;
  }
  
  const marginData = margin || { marginPurchase: 0, marginSale: 0, marginBalance: 0, marginBalanceToday: 0, marginBalancePrev: 0, marginLimit: 0, shortSale: 0, shortCover: 0, shortBalance: 0, shortBalanceToday: 0, shortBalancePrev: 0 };
  const instData = institutional || { foreign: 0, trust: 0, investment: 0, dealer: 0, total: 0 };

  const result = {
    stock: dailyTrade,
    margin: marginData,
    institutional: instData,
    marginTrading: marginData,
    institutionalInvestors: instData
  };
  
  logger.success(`籌碼資料抓取完成：${stockCode}`);
  return result;
}

/**
 * 格式化籌碼資料
 */
function formatChipData(data) {
  if (!data) return '無資料';
  
  const { stock, margin, institutional } = data;
  
  let output = [];
  output.push(`${stock.name} (${stock.code})`);
  output.push(`收盤：${stock.closingPrice} (${stock.change >= 0 ? '+' : ''}${stock.change})`);
  output.push(`成交量：${stock.volume.toLocaleString()} 股`);
  output.push('');
  output.push('融資融券：');
  output.push(`  融資餘額：${margin.marginBalance.toLocaleString()} 張`);
  output.push(`  融券餘額：${margin.shortBalance.toLocaleString()} 張`);
  output.push('');
  output.push('三大法人買賣超：');
  output.push(`  外資：${institutional.foreign >= 0 ? '+' : ''}${institutional.foreign.toLocaleString()} 張`);
  output.push(`  投信：${institutional.investment >= 0 ? '+' : ''}${institutional.investment.toLocaleString()} 張`);
  output.push(`  自營商：${institutional.dealer >= 0 ? '+' : ''}${institutional.dealer.toLocaleString()} 張`);
  output.push(`  合計：${institutional.total >= 0 ? '+' : ''}${institutional.total.toLocaleString()} 張`);
  
  return output.join('\n');
}

/**
 * 批次抓取
 */
async function batchFetch(stockCodes, date = null) {
  logger.info(`批次抓取 ${stockCodes.length} 支股票`);
  
  const results = await Promise.all(
    stockCodes.map(code => getChipData(code, date))
  );
  
  const successful = results.filter(r => r !== null);
  logger.success('批次抓取完成', { 
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
  const date = args[2];
  
  try {
    if (command === 'fetch' && stockCode) {
      const data = await getChipData(stockCode, date);
      if (data) {
        console.log(formatChipData(data));
      }
    } else if (command === 'batch' && stockCode) {
      const codes = stockCode.split(',');
      const results = await batchFetch(codes, date);
      results.forEach(data => {
        if (data) {
          console.log(formatChipData(data));
          console.log('---');
        }
      });
    } else if (command === 'clear-cache') {
      cache.clear();
    } else if (command === 'stats') {
      console.log('快取統計：', cache.getStats());
    } else {
      logger.info(`
Chip Data Fetcher - 籌碼面數據抓取

指令：
  fetch <股票代號> [日期]     - 抓取單一股票
  batch <股票代號,股票代號> [日期] - 批次抓取
  clear-cache              - 清除快取
  stats                    - 顯示統計

範例：
  node chip-data-fetcher.js fetch 2330
  node chip-data-fetcher.js fetch 2330 20260216
  node chip-data-fetcher.js batch 2330,2454,2412
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
  getChipData,
  getDailyTrade,
  getMarginTrading,
  getInstitutionalInvestors,
  batchFetch
};
