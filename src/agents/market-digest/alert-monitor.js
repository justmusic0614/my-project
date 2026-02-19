#!/usr/bin/env node
const { createLogger } = require("./shared/logger");
const logger = createLogger("alert-monitor");
// Alert Monitor - 智慧提醒監控（A 項目）
// 檢測異常事件並推播到 Telegram

const fs = require('fs');
const path = require('path');
const { getChipData } = require('./chip-data-fetcher');
const { comprehensiveAnalysis } = require('./chip-analyzer');

const WATCHLIST_PATH = path.join(__dirname, 'data/watchlist.json');
const ALERT_HISTORY_PATH = path.join(__dirname, 'data/alert-history.json');

/**
 * 異常檢測規則
 */
const ALERT_RULES = {
  // 融資使用率危險（> 30%）
  marginDanger: {
    enabled: true,
    threshold: 30,
    cooldown: 86400000, // 24 小時內不重複通知
    priority: 'high'
  },
  
  // 融資使用率偏高（> 20%）
  marginWarning: {
    enabled: true,
    threshold: 20,
    cooldown: 86400000,
    priority: 'medium'
  },
  
  // 融資單日大增（> 10%）
  marginSurge: {
    enabled: true,
    threshold: 10,
    cooldown: 86400000,
    priority: 'medium'
  },
  
  // 外資強勢買超（> 10000 張）
  foreignStrongBuy: {
    enabled: true,
    threshold: 10000000, // 股數
    cooldown: 86400000,
    priority: 'high'
  },
  
  // 外資強勢賣超（> 10000 張）
  foreignStrongSell: {
    enabled: true,
    threshold: 10000000,
    cooldown: 86400000,
    priority: 'high'
  },
  
  // 投信大幅買超（> 2000 張）
  trustStrongBuy: {
    enabled: true,
    threshold: 2000000,
    cooldown: 86400000,
    priority: 'medium'
  },
  
  // 融券大幅回補（> 15%）
  shortCover: {
    enabled: true,
    threshold: 15,
    cooldown: 86400000,
    priority: 'medium'
  },
  
  // 籌碼評分極低（< 30）
  scoreDanger: {
    enabled: true,
    threshold: 30,
    cooldown: 86400000,
    priority: 'high'
  }
};

/**
 * 讀取提醒歷史
 */
function loadAlertHistory() {
  if (!fs.existsSync(ALERT_HISTORY_PATH)) {
    return { alerts: [] };
  }
  
  return JSON.parse(fs.readFileSync(ALERT_HISTORY_PATH, 'utf8'));
}

/**
 * 儲存提醒歷史
 */
function saveAlertHistory(history) {
  const dir = path.dirname(ALERT_HISTORY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(ALERT_HISTORY_PATH, JSON.stringify(history, null, 2));
}

/**
 * 檢查是否在冷卻期內
 */
function isInCooldown(stockCode, alertType, cooldown) {
  const history = loadAlertHistory();
  const now = Date.now();
  
  const recent = history.alerts.find(a => 
    a.stockCode === stockCode && 
    a.alertType === alertType &&
    (now - new Date(a.timestamp).getTime()) < cooldown
  );
  
  return !!recent;
}

/**
 * 記錄提醒
 */
function recordAlert(stockCode, stockName, alertType, message, priority) {
  const history = loadAlertHistory();
  
  history.alerts.push({
    stockCode,
    stockName,
    alertType,
    message,
    priority,
    timestamp: new Date().toISOString()
  });
  
  // 只保留最近 30 天
  const thirtyDaysAgo = Date.now() - 30 * 86400000;
  history.alerts = history.alerts.filter(a => 
    new Date(a.timestamp).getTime() > thirtyDaysAgo
  );
  
  saveAlertHistory(history);
}

/**
 * 檢測單檔股票異常
 */
function detectAlerts(stockCode, stockName, chipData, analysis) {
  const alerts = [];
  
  if (!chipData || !analysis) {
    return alerts;
  }
  
  // 1. 融資使用率危險
  if (ALERT_RULES.marginDanger.enabled && chipData.marginTrading) {
    const usage = (chipData.marginTrading.marginBalanceToday / chipData.marginTrading.marginLimit * 100);
    
    if (usage > ALERT_RULES.marginDanger.threshold) {
      if (!isInCooldown(stockCode, 'marginDanger', ALERT_RULES.marginDanger.cooldown)) {
        alerts.push({
          type: 'marginDanger',
          priority: ALERT_RULES.marginDanger.priority,
          icon: '🔴',
          message: `融資使用率 ${usage.toFixed(2)}% 過高，投機氣氛濃厚`
        });
      }
    }
  }
  
  // 2. 融資使用率偏高
  if (ALERT_RULES.marginWarning.enabled && chipData.marginTrading) {
    const usage = (chipData.marginTrading.marginBalanceToday / chipData.marginTrading.marginLimit * 100);
    
    if (usage > ALERT_RULES.marginWarning.threshold && usage <= ALERT_RULES.marginDanger.threshold) {
      if (!isInCooldown(stockCode, 'marginWarning', ALERT_RULES.marginWarning.cooldown)) {
        alerts.push({
          type: 'marginWarning',
          priority: ALERT_RULES.marginWarning.priority,
          icon: '🟡',
          message: `融資使用率 ${usage.toFixed(2)}% 偏高`
        });
      }
    }
  }
  
  // 3. 融資單日大增
  if (ALERT_RULES.marginSurge.enabled && chipData.marginTrading) {
    const change = chipData.marginTrading.marginBalanceToday - chipData.marginTrading.marginBalancePrev;
    const changePercent = chipData.marginTrading.marginBalancePrev > 0 
      ? (change / chipData.marginTrading.marginBalancePrev * 100) 
      : 0;
    
    if (changePercent > ALERT_RULES.marginSurge.threshold) {
      if (!isInCooldown(stockCode, 'marginSurge', ALERT_RULES.marginSurge.cooldown)) {
        alerts.push({
          type: 'marginSurge',
          priority: ALERT_RULES.marginSurge.priority,
          icon: '🟡',
          message: `融資單日大增 ${changePercent.toFixed(2)}%，投機買盤進場`
        });
      }
    }
  }
  
  // 4. 外資強勢買超
  if (ALERT_RULES.foreignStrongBuy.enabled && chipData.institutionalInvestors) {
    if (chipData.institutionalInvestors.foreign > ALERT_RULES.foreignStrongBuy.threshold) {
      if (!isInCooldown(stockCode, 'foreignStrongBuy', ALERT_RULES.foreignStrongBuy.cooldown)) {
        alerts.push({
          type: 'foreignStrongBuy',
          priority: ALERT_RULES.foreignStrongBuy.priority,
          icon: '🟢',
          message: `外資強勢買超 ${(chipData.institutionalInvestors.foreign / 1000).toFixed(0)} 張`
        });
      }
    }
  }
  
  // 5. 外資強勢賣超
  if (ALERT_RULES.foreignStrongSell.enabled && chipData.institutionalInvestors) {
    if (chipData.institutionalInvestors.foreign < -ALERT_RULES.foreignStrongSell.threshold) {
      if (!isInCooldown(stockCode, 'foreignStrongSell', ALERT_RULES.foreignStrongSell.cooldown)) {
        alerts.push({
          type: 'foreignStrongSell',
          priority: ALERT_RULES.foreignStrongSell.priority,
          icon: '🔴',
          message: `外資強勢賣超 ${Math.abs(chipData.institutionalInvestors.foreign / 1000).toFixed(0)} 張`
        });
      }
    }
  }
  
  // 6. 投信大幅買超
  if (ALERT_RULES.trustStrongBuy.enabled && chipData.institutionalInvestors) {
    if (chipData.institutionalInvestors.trust > ALERT_RULES.trustStrongBuy.threshold) {
      if (!isInCooldown(stockCode, 'trustStrongBuy', ALERT_RULES.trustStrongBuy.cooldown)) {
        alerts.push({
          type: 'trustStrongBuy',
          priority: ALERT_RULES.trustStrongBuy.priority,
          icon: '🟢',
          message: `投信大幅買超 ${(chipData.institutionalInvestors.trust / 1000).toFixed(0)} 張`
        });
      }
    }
  }
  
  // 7. 融券大幅回補
  if (ALERT_RULES.shortCover.enabled && chipData.marginTrading) {
    const change = chipData.marginTrading.shortBalanceToday - chipData.marginTrading.shortBalancePrev;
    const changePercent = chipData.marginTrading.shortBalancePrev > 0 
      ? (change / chipData.marginTrading.shortBalancePrev * 100) 
      : 0;
    
    if (changePercent < -ALERT_RULES.shortCover.threshold && chipData.marginTrading.shortBalancePrev > 1000) {
      if (!isInCooldown(stockCode, 'shortCover', ALERT_RULES.shortCover.cooldown)) {
        alerts.push({
          type: 'shortCover',
          priority: ALERT_RULES.shortCover.priority,
          icon: '🟢',
          message: `融券大幅回補 ${Math.abs(changePercent).toFixed(2)}%，空頭回補推升股價`
        });
      }
    }
  }
  
  // 8. 籌碼評分極低
  if (ALERT_RULES.scoreDanger.enabled && analysis.score < ALERT_RULES.scoreDanger.threshold) {
    if (!isInCooldown(stockCode, 'scoreDanger', ALERT_RULES.scoreDanger.cooldown)) {
      alerts.push({
        type: 'scoreDanger',
        priority: ALERT_RULES.scoreDanger.priority,
        icon: '🔴',
        message: `籌碼評分 ${analysis.score}/100 極低，建議觀望`
      });
    }
  }
  
  return alerts;
}

/**
 * 監控 Watchlist 並生成提醒
 */
async function monitorWatchlist() {
  if (!fs.existsSync(WATCHLIST_PATH)) {
    logger.info('📭 Watchlist 是空的');
    return { alerts: [] };
  }
  
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
  
  if (watchlist.stocks.length === 0) {
    logger.info('📭 Watchlist 是空的');
    return { alerts: [] };
  }
  
  logger.info(`🔍 正在監控 ${watchlist.stocks.length} 檔股票...\n`);
  
  const results = [];
  
  for (const stock of watchlist.stocks) {
    logger.info(`⏳ 檢查 ${stock.code} ${stock.name}...`);
    
    try {
      const chipData = await getChipData(stock.code);
      
      if (chipData) {
        const analysis = comprehensiveAnalysis(chipData);
        const alerts = detectAlerts(stock.code, stock.name, chipData, analysis);
        
        if (alerts.length > 0) {
          // 記錄提醒
          alerts.forEach(alert => {
            recordAlert(stock.code, stock.name, alert.type, alert.message, alert.priority);
          });
          
          results.push({
            stockCode: stock.code,
            stockName: stock.name,
            score: analysis.score,
            alerts: alerts
          });
          
          logger.info(`⚠️  發現 ${alerts.length} 個異常`);
        } else {
          logger.info(`✅ 正常`);
        }
      }
      
      // 禮貌間隔
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      logger.error(`❌ ${stock.code} 檢查失敗：${err.message}`);
    }
  }
  
  return {
    timestamp: new Date().toISOString(),
    alertCount: results.reduce((sum, r) => sum + r.alerts.length, 0),
    stocks: results
  };
}

/**
 * 格式化提醒報告
 */
function formatAlertReport(report) {
  if (!report || report.alertCount === 0) {
    return '✅ 無異常提醒';
  }
  
  const lines = [];
  
  lines.push(`⚠️  異常提醒（${report.alertCount} 項）`);
  lines.push(`🕒 ${new Date(report.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 依優先級排序
  const high = report.stocks.filter(s => s.alerts.some(a => a.priority === 'high'));
  const medium = report.stocks.filter(s => s.alerts.some(a => a.priority === 'medium') && !high.includes(s));
  
  if (high.length > 0) {
    lines.push(`🔴 高優先級（${high.length} 檔）`);
    lines.push('');
    high.forEach(stock => {
      lines.push(`${stock.stockCode} ${stock.stockName} [評分 ${stock.score}]`);
      stock.alerts.forEach(alert => {
        lines.push(`  ${alert.icon} ${alert.message}`);
      });
      lines.push('');
    });
  }
  
  if (medium.length > 0) {
    lines.push(`🟡 中優先級（${medium.length} 檔）`);
    lines.push('');
    medium.forEach(stock => {
      lines.push(`${stock.stockCode} ${stock.stockName} [評分 ${stock.score}]`);
      stock.alerts.forEach(alert => {
        lines.push(`  ${alert.icon} ${alert.message}`);
      });
      lines.push('');
    });
  }
  
  return lines.join('\n');
}

// CLI 模式（已廢棄）
if (require.main === module) {
  console.error('⚠️  此腳本已廢棄，請使用統一入口：');
  console.error('    node index.js cmd <子命令>');
  console.error('    node index.js today');
  console.error('📖 完整說明：node index.js（無參數）');
  process.exit(1);

  // 以下為原始 CLI 程式碼（已停用）
  const command = process.argv[2];

  if (command === 'monitor') {
    (async () => {
      const report = await monitorWatchlist();
      const formatted = formatAlertReport(report);
      logger.info('\n' + formatted);
    })();
    
  } else if (command === 'history') {
    const days = parseInt(process.argv[3] || '7', 10);
    const history = loadAlertHistory();
    const cutoff = Date.now() - days * 86400000;
    
    const recent = history.alerts.filter(a => 
      new Date(a.timestamp).getTime() > cutoff
    );
    
    logger.info(`\n📊 最近 ${days} 天的提醒歷史（${recent.length} 筆）`);
    logger.info('━━━━━━━━━━━━━━━━━━\n');
    
    // 依股票分組
    const byStock = {};
    recent.forEach(alert => {
      if (!byStock[alert.stockCode]) {
        byStock[alert.stockCode] = [];
      }
      byStock[alert.stockCode].push(alert);
    });
    
    Object.keys(byStock).forEach(code => {
      const alerts = byStock[code];
      logger.info(`${code} ${alerts[0].stockName}（${alerts.length} 次）`);
      alerts.forEach(alert => {
        const date = new Date(alert.timestamp).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });
        logger.info(`  ${date} - ${alert.message}`);
      });
      logger.info('');
    });
    
  } else {
    logger.info(`
Alert Monitor - 智慧提醒監控

指令：
  monitor                    監控 Watchlist 並檢測異常
  history [days]             查看提醒歷史（預設 7 天）

範例：
  node alert-monitor.js monitor
  node alert-monitor.js history 30

功能：
  • 融資使用率監控
  • 法人大幅買賣超檢測
  • 融券回補檢測
  • 籌碼評分監控
  • 24 小時冷卻期（避免重複通知）

A 項目：智慧提醒強化
    `);
  }
}

module.exports = {
  monitorWatchlist,
  formatAlertReport,
  detectAlerts,
  ALERT_RULES
};
