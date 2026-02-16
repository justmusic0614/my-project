// Integration Example
// 展示如何將 Risk-off Monitoring 整合到現有系統

/**
 * 在 backend/runtime-gen.js 中整合 Risk-off Monitoring
 *
 * 位置：第 156-170 行附近（Risk-off Analyzer 之後）
 */

// ========== EXISTING CODE (runtime-gen.js line ~154-156) ==========
console.log('📊 分析 Risk-off 情緒...');
const RiskOffAnalyzer = require('../analyzers/risk-off-analyzer');
const riskOffAnalysis = RiskOffAnalyzer.analyzeRiskOff(marketData, allEventTitles);

// ========== NEW CODE - ADD BELOW ==========
// 16.8. RISK-OFF MONITORING
console.log('📝 記錄 Risk-off 監控數據...');
try {
  const { monitorRiskOff } = require('../monitor-risk-off');

  // 取得前一天數據（如果有）
  const previousData = getPreviousDayData(); // 需要實作此函數

  // 執行監控（記錄、警報、報告）
  const monitoringResult = await monitorRiskOff(
    marketData,
    allEventTitles,
    previousData,
    new Date().toISOString().split('T')[0]
  );

  // 如果有警報，可以加入到 Telegram 推播中
  if (monitoringResult.alert) {
    console.log(`⚠️ Alert triggered: ${monitoringResult.alert.level}`);
    // TODO: 發送 Telegram 通知
    // await sendTelegramAlert(monitoringResult.alert);
  }

  console.log('✅ Risk-off monitoring completed');
} catch (err) {
  console.error('❌ Error in Risk-off monitoring:', err.message);
  // 不影響主流程，繼續執行
}

// ========== CONTINUE WITH EXISTING CODE ==========
// 16.7. SECTOR ANALYZER
let sectorAnalysis = null;
// ... (rest of the code)


/**
 * 輔助函數：取得前一天市場數據
 *
 * 選項 1：從日誌讀取
 */
function getPreviousDayData() {
  try {
    const RiskOffLogger = require('../utils/risk-off-logger');
    const logger = new RiskOffLogger();

    // 計算前一個交易日
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 如果是週末，往前找到週五
    while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
      yesterday.setDate(yesterday.getDate() - 1);
    }

    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const log = logger.getLog(yesterdayStr);

    if (log && log.marketData) {
      return {
        vix: log.marketData.vix,
        foreign: { netBuy: log.marketData.foreignFlow },
        gold: { change: log.marketData.goldChange },
        usd_jpy: { change: log.marketData.jpyChange },
        stockIndex: { change: log.marketData.indexChange }
      };
    }
  } catch (err) {
    console.error('Could not load previous day data:', err.message);
  }

  return null;
}

/**
 * 選項 2：從 backend/runtime-gen.js 的歷史數據結構讀取
 * （如果你已經有儲存前一天數據的機制）
 */
function getPreviousDayDataFromBackend() {
  // TODO: 實作從你現有的數據儲存機制讀取
  // 例如：從 data/ 目錄、資料庫、或記憶體快取
  return null;
}


/**
 * Telegram 警報推播範例
 */
async function sendTelegramAlert(alert) {
  // TODO: 整合你現有的 Telegram Bot
  // 範例：
  // const bot = require('../telegram-bot');
  // const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  //
  // const message = `
  // 🚨 ${alert.level} Risk-off Alert!
  //
  // Score: ${alert.score}/100
  //
  // ${alert.recommendation}
  // `;
  //
  // await bot.sendMessage(chatId, message);
}

module.exports = {
  getPreviousDayData,
  sendTelegramAlert
};
