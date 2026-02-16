#!/usr/bin/env node

// Telegram Health Monitor - Kanban Dashboard SRE
// 執行所有健康檢查，儲存結果，異常時發送告警

const fs = require('fs');
const path = require('path');
const { createHealthCheckSystem } = require('./health-check');
const { createAlertService } = require('./alert-service');

// 環境變數（確保載入 .env）
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 路徑配置
const LOG_DIR = path.join(__dirname, '../logs/health');
const STATUS_FILE = path.join(LOG_DIR, 'current-status.json');

// 確保日誌目錄存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 儲存健康檢查結果到檔案
 */
function saveResults(overallStatus) {
  try {
    // 儲存到當前狀態檔案（供其他工具讀取）
    fs.writeFileSync(STATUS_FILE, JSON.stringify(overallStatus, null, 2));

    // 儲存到日期日誌檔案
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `health-${date}.log`);

    const logEntry = `[${overallStatus.timestamp}] ${overallStatus.status} - ${overallStatus.checks.healthy}/${overallStatus.checks.total} checks passed\n`;

    fs.appendFileSync(logFile, logEntry);

    console.log(`📝 Results saved to ${STATUS_FILE}`);
  } catch (err) {
    console.error(`❌ Failed to save results:`, err.message);
  }
}

/**
 * 發送告警（如果需要）
 */
async function sendAlertsIfNeeded(overallStatus, alertService) {
  const { status, checks, results } = overallStatus;

  // 只在 CRITICAL 或 DEGRADED 狀態時發送告警
  if (status === 'HEALTHY') {
    console.log('✅ System healthy, no alerts needed');
    return;
  }

  // 收集失敗的檢查項目
  const failedChecks = results.filter(r => r.status === 'UNHEALTHY');
  const criticalFailures = failedChecks.filter(r => r.critical);

  // 建立告警訊息
  let message = '';
  let level = 'WARNING';

  if (status === 'CRITICAL') {
    message = `System is in CRITICAL state!\n${criticalFailures.length} critical check(s) failed.`;
    level = 'CRITICAL';
  } else if (status === 'DEGRADED') {
    message = `System is DEGRADED.\n${failedChecks.length} check(s) failed.`;
    level = 'WARNING';
  }

  // 準備詳細資訊
  const details = {
    totalChecks: checks.total,
    healthyChecks: checks.healthy,
    failedChecks: checks.unhealthy,
    criticalFailures: checks.criticalUnhealthy,
    failedItems: failedChecks.map(c => `${c.name}: ${c.error}`).join('; ')
  };

  // 發送告警
  console.log(`\n⚠️  Sending ${level} alert...`);
  const result = await alertService.sendAlert(message, level, details);

  if (result.success) {
    console.log('✅ Alert sent successfully');
  } else if (result.skipped) {
    console.log('⏭️  Alert skipped (cooldown period)');
  } else {
    console.error(`❌ Failed to send alert: ${result.error}`);
  }
}

/**
 * 主函數
 */
async function main() {
  console.log('━'.repeat(60));
  console.log('🏥 Kanban Dashboard Health Monitor');
  console.log(`📅 Time: ${new Date().toISOString()}`);
  console.log('━'.repeat(60) + '\n');

  try {
    // 建立健康檢查系統
    const healthCheck = createHealthCheckSystem();

    // 執行所有檢查
    const overallStatus = await healthCheck.runAll();

    // 儲存結果
    saveResults(overallStatus);

    // 建立告警服務
    const alertService = createAlertService();

    // 發送告警（如果需要）
    await sendAlertsIfNeeded(overallStatus, alertService);

    // 回傳 exit code
    if (overallStatus.status === 'CRITICAL') {
      console.log('\n❌ Health check FAILED (CRITICAL)');
      process.exit(1);
    } else if (overallStatus.status === 'DEGRADED') {
      console.log('\n⚠️  Health check DEGRADED');
      process.exit(0); // DEGRADED 不算失敗，回傳 0
    } else {
      console.log('\n✅ Health check PASSED');
      process.exit(0);
    }
  } catch (err) {
    console.error('\n💥 Health check crashed:', err);
    console.error(err.stack);

    // 嘗試發送 CRITICAL 告警
    try {
      const alertService = createAlertService();
      await alertService.sendAlert(
        `Health check crashed: ${err.message}`,
        'CRITICAL',
        { error: err.stack }
      );
    } catch (alertErr) {
      console.error('Failed to send crash alert:', alertErr.message);
    }

    process.exit(1);
  }
}

// 執行
main();
