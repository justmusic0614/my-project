#!/usr/bin/env node
// Risk-off Monitoring Script
// 監控每日 Risk-off Score 並生成報告、發送警報

const { analyzeRiskOff } = require('./analyzers/risk-off-analyzer');
const { analyzeSectorPerformance } = require('./analyzers/sector-analyzer');
const RiskOffLogger = require('./utils/risk-off-logger');
const AlertManager = require('./utils/alert-manager');
const DailySummaryGenerator = require('./utils/daily-summary-generator');

/**
 * 執行 Risk-off 監控
 * @param {Object} marketData - 市場數據
 * @param {Array} newsItems - 新聞項目
 * @param {Object} previousData - 前一天市場數據（可選）
 * @param {string} date - 日期（可選，預設今天）
 * @param {Object} sectorData - 板塊數據（可選）
 */
async function monitorRiskOff(marketData, newsItems = [], previousData = null, date = null, sectorData = null) {
  console.log('\n' + '='.repeat(60));
  console.log('Risk-off Monitoring System V2 (Enhanced)');
  console.log('='.repeat(60) + '\n');

  const today = date || new Date().toISOString().split('T')[0];
  console.log(`Date: ${today}\n`);

  // 1. 執行 Risk-off 分析
  console.log('📊 Analyzing Risk-off sentiment...');
  const analysis = analyzeRiskOff(marketData, newsItems, previousData);
  console.log(`   Score: ${analysis.score}/100 ${analysis.signal} (${analysis.level})`);
  console.log(`   ${analysis.description}\n`);

  // 2. 執行板塊分析（如有數據）
  let sectorAnalysis = null;
  if (sectorData) {
    console.log('🎯 Analyzing sector rotation...');
    sectorAnalysis = analyzeSectorPerformance(sectorData);
    console.log(`   Signal: ${sectorAnalysis.signal}`);
    console.log(`   Spread: ${sectorAnalysis.rotation.spread}%\n`);
  }

  // 3. 記錄到日誌
  console.log('📝 Logging to history...');
  const logger = new RiskOffLogger();
  const logEntry = logger.log(analysis, marketData, today);

  // 4. 取得歷史統計和最近日誌（用於趨勢圖）
  const stats = logger.getStats(30);
  const recentLogs = logger.getRecentLogs(7); // 最近 7 天

  if (stats) {
    console.log(`   Historical avg: ${stats.avgScore} (past ${stats.totalDays} days)`);
    console.log(`   HIGH days: ${stats.levelDistribution.HIGH}`);
    console.log(`   Recent logs: ${recentLogs.length} days\n`);
  }

  // 5. 檢查並發送警報
  console.log('🚨 Checking for alerts...');
  const alertManager = new AlertManager();
  const alert = logger.checkAlert(analysis, { HIGH: 70, CRITICAL: 85 });

  let alertEntry = null;
  if (alert) {
    console.log(`   Alert triggered: ${alert.level}`);
    alertEntry = alertManager.sendAlert(alert, analysis, today);
  } else {
    console.log('   No alerts (Score < 70)\n');
  }

  // 6. 生成每日摘要報告（包含板塊分析和趨勢圖）
  console.log('📄 Generating enhanced daily summary report...');
  const summaryGen = new DailySummaryGenerator();
  const alerts = alertEntry ? [alertEntry] : [];
  const report = summaryGen.generate(
    analysis,
    marketData,
    stats,
    alerts,
    today,
    sectorAnalysis,    // 新增：板塊分析
    recentLogs         // 新增：最近日誌（用於趨勢圖）
  );

  console.log('\n' + '='.repeat(60));
  console.log('✅ Monitoring Complete');
  console.log('='.repeat(60) + '\n');

  return {
    analysis,
    logEntry,
    alert: alertEntry,
    report
  };
}

/**
 * 測試模式 - 使用模擬數據
 */
async function testMode() {
  console.log('Running in TEST MODE with simulated data\n');

  // 模擬市場數據
  const marketData = {
    vix: 22.5,
    gold: { change: 1.2 },
    foreign: { netBuy: -8000 },
    stockIndex: { change: -1.5 },
    usd_jpy: { change: -0.8 },
    volatility: { daily: 1.8 }
  };

  // 模擬新聞
  const newsItems = [
    { title: '外資賣超台股 80 億元' },
    { title: 'VIX 指數升至 22.5' }
  ];

  // 模擬前一天數據
  const previousData = {
    vix: 20.0,
    foreign: { netBuy: -5000 }
  };

  // 模擬板塊數據
  const sectorData = {
    // Defensive sectors
    utilities: { change: 2.5 },
    healthcare: { change: 1.8 },
    consumer_staples: { change: 0.3 },
    telecom: { change: 1.2 },

    // Cyclical sectors
    tech: { change: -1.5 },
    finance: { change: -0.8 },
    industrial: { change: -1.2 },
    consumer_discretionary: { change: -0.5 },
    energy: { change: -2.1 },
    materials: { change: -1.8 }
  };

  const result = await monitorRiskOff(marketData, newsItems, previousData, null, sectorData);

  console.log('\nTest Result Summary:');
  console.log('-------------------');
  console.log(`Score: ${result.analysis.score}`);
  console.log(`Level: ${result.analysis.level}`);
  console.log(`Alert: ${result.alert ? result.alert.level : 'None'}`);
  console.log(`Report: ${result.report.date}`);
}

// 如果直接執行此腳本
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--test')) {
    testMode().catch(err => {
      console.error('Error in test mode:', err);
      process.exit(1);
    });
  } else {
    console.log('Usage:');
    console.log('  node monitor-risk-off.js --test    # Run in test mode');
    console.log('');
    console.log('For production use, integrate this module into your daily report generator:');
    console.log('');
    console.log('  const { monitorRiskOff } = require("./monitor-risk-off");');
    console.log('  await monitorRiskOff(marketData, newsItems, previousData);');
    console.log('');
  }
}

module.exports = { monitorRiskOff };
