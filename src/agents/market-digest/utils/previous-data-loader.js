// Previous Data Loader
// 從日誌讀取前一天市場數據

const fs = require('fs');
const path = require('path');

/**
 * 取得前一個交易日的市場數據
 * @param {string} logDir - 日誌目錄
 * @returns {Object|null} 前一天的市場數據，或 null
 */
function getPreviousDayData(logDir = './logs/risk-off') {
  try {
    // 計算前一個交易日
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 如果是週末，往前找到週五
    while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
      yesterday.setDate(yesterday.getDate() - 1);
    }

    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const logPath = path.join(logDir, `${yesterdayStr}.json`);

    // 檢查日誌檔案是否存在
    if (!fs.existsSync(logPath)) {
      console.log(`   No previous day data found for ${yesterdayStr}`);
      return null;
    }

    // 讀取日誌
    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));

    if (!log.marketData) {
      console.log(`   Previous day data incomplete for ${yesterdayStr}`);
      return null;
    }

    // 轉換為 analyzer 需要的格式
    const previousData = {
      vix: log.marketData.vix,
      foreign: { netBuy: log.marketData.foreignFlow },
      gold: { change: log.marketData.goldChange },
      usd_jpy: { change: log.marketData.jpyChange },
      stockIndex: { change: log.marketData.indexChange }
    };

    console.log(`   Loaded previous day data: ${yesterdayStr} (VIX: ${previousData.vix}, Foreign: ${previousData.foreign.netBuy})`);
    return previousData;
  } catch (err) {
    console.error('   Error loading previous day data:', err.message);
    return null;
  }
}

/**
 * 取得指定日期的市場數據
 * @param {string} date - 日期 (YYYY-MM-DD)
 * @param {string} logDir - 日誌目錄
 * @returns {Object|null}
 */
function getDataByDate(date, logDir = './logs/risk-off') {
  try {
    const logPath = path.join(logDir, `${date}.json`);

    if (!fs.existsSync(logPath)) {
      return null;
    }

    const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));

    if (!log.marketData) {
      return null;
    }

    return {
      vix: log.marketData.vix,
      foreign: { netBuy: log.marketData.foreignFlow },
      gold: { change: log.marketData.goldChange },
      usd_jpy: { change: log.marketData.jpyChange },
      stockIndex: { change: log.marketData.indexChange }
    };
  } catch (err) {
    console.error(`Error loading data for ${date}:`, err.message);
    return null;
  }
}

module.exports = {
  getPreviousDayData,
  getDataByDate
};
