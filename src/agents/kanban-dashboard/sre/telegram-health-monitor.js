#!/usr/bin/env node

// Telegram Health Monitor - Kanban Dashboard SRE
// 執行所有健康檢查，儲存結果，異常時發送告警

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHealthCheckSystem } = require('./health-check');
const { createAlertService } = require('./alert-service');

// 環境變數（確保載入 .env）
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 路徑配置
const LOG_DIR = path.join(__dirname, '../logs/health');
const STATUS_FILE = path.join(LOG_DIR, 'current-status.json');

// 告警門檻設定
const CRITICAL_THRESHOLD = 2;  // 連續 2 次 CRITICAL 才發告警
const DEGRADED_THRESHOLD = 3;  // 連續 3 次 DEGRADED 才發告警

// 確保日誌目錄存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 讀取上次的健康狀態（含 consecutiveFailures）
 */
function loadPreviousStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn(`⚠️  Could not load previous status: ${err.message}`);
  }
  return null;
}

/**
 * 儲存健康檢查結果到檔案（含 consecutiveFailures）
 */
function saveResults(overallStatus, consecutiveFailures) {
  try {
    // 儲存到當前狀態檔案（含 consecutiveFailures 供下次讀取）
    const toSave = {
      ...overallStatus,
      consecutiveFailures,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(toSave, null, 2));

    // 儲存到日期日誌檔案
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `health-${date}.log`);

    const logEntry = `[${overallStatus.timestamp}] ${overallStatus.status} (consecutive: ${consecutiveFailures}) - ${overallStatus.checks.healthy}/${overallStatus.checks.total} checks passed\n`;

    fs.appendFileSync(logFile, logEntry);

    console.log(`📝 Results saved to ${STATUS_FILE}`);
  } catch (err) {
    console.error(`❌ Failed to save results:`, err.message);
  }
}

/**
 * 自動自癒：偵測到 PM2 errored 時自動重啟
 * 只在 errored（已耗盡 max_restarts）時介入，stopping/stopped 不處理
 */
async function autoHealIfNeeded(overallStatus) {
  const pm2Failed = overallStatus.results.find(
    r => r.name === 'pm2-status' && r.status === 'UNHEALTHY'
  );
  if (!pm2Failed || !pm2Failed.error || !pm2Failed.error.includes('errored')) {
    return false;
  }

  console.log('\n🔄 Auto-heal: PM2 errored detected, issuing restart...');
  try {
    const { execSync } = require('child_process');
    execSync('pm2 restart kanban-dashboard', { timeout: 30000 });
    console.log('✅ pm2 restart kanban-dashboard issued');
    return true;
  } catch (err) {
    console.error(`❌ Auto-heal failed: ${err.message}`);
    return false;
  }
}

/**
 * 發送告警（含連續失敗門檻過濾）
 */
async function sendAlertsIfNeeded(overallStatus, alertService, consecutiveFailures) {
  const { status, checks, results } = overallStatus;

  // 只在 CRITICAL 或 DEGRADED 狀態時發送告警
  if (status === 'HEALTHY') {
    console.log('✅ System healthy, no alerts needed');
    return;
  }

  // 連續失敗門檻檢查（降噪）
  if (status === 'CRITICAL' && consecutiveFailures < CRITICAL_THRESHOLD) {
    console.log(`⏳ CRITICAL but only ${consecutiveFailures}/${CRITICAL_THRESHOLD} consecutive failures — waiting for confirmation`);
    return;
  }

  if (status === 'DEGRADED' && consecutiveFailures < DEGRADED_THRESHOLD) {
    console.log(`⏳ DEGRADED but only ${consecutiveFailures}/${DEGRADED_THRESHOLD} consecutive failures — skipping alert`);
    return;
  }

  // 收集失敗的檢查項目
  const failedChecks = results.filter(r => r.status === 'UNHEALTHY');
  const criticalFailures = failedChecks.filter(r => r.critical);

  // 建立告警訊息
  let message = '';
  let level = 'WARNING';

  if (status === 'CRITICAL') {
    message = `System is in CRITICAL state! (${consecutiveFailures} consecutive failures)\n${criticalFailures.length} critical check(s) failed.`;
    level = 'CRITICAL';
  } else if (status === 'DEGRADED') {
    message = `System is DEGRADED. (${consecutiveFailures} consecutive failures)\n${failedChecks.length} check(s) failed.`;
    level = 'WARNING';
  }

  // 準備詳細資訊
  const [load1] = os.loadavg();
  const details = {
    totalChecks: checks.total,
    healthyChecks: checks.healthy,
    failedChecks: checks.unhealthy,
    criticalFailures: checks.criticalUnhealthy,
    consecutiveFailures,
    systemLoad: load1.toFixed(2),
    failedItems: failedChecks.map(c => {
      const duration = c.duration ? ` (${c.duration}ms)` : '';
      return `${c.name}${duration}: ${c.error}`;
    }).join('; ')
  };

  // 發送告警（傳入固定 alertType，讓 cooldown 正確運作）
  console.log(`\n⚠️  Sending ${level} alert (consecutive: ${consecutiveFailures})...`);
  const result = await alertService.sendAlert(message, level, details, 'health-check');

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
    // 讀取上次狀態（用於計算 consecutiveFailures）
    const previousStatus = loadPreviousStatus();

    // 建立健康檢查系統
    const healthCheck = createHealthCheckSystem();

    // 執行所有檢查
    const overallStatus = await healthCheck.runAll();

    // 計算連續失敗次數
    const isUnhealthy = overallStatus.status !== 'HEALTHY';
    const consecutiveFailures = isUnhealthy
      ? (previousStatus?.consecutiveFailures || 0) + 1
      : 0;

    if (isUnhealthy) {
      console.log(`📊 Consecutive failures: ${consecutiveFailures}`);
    }

    // 儲存結果（含 consecutiveFailures）
    saveResults(overallStatus, consecutiveFailures);

    // 建立告警服務
    const alertService = createAlertService();

    // 發送告警（含門檻過濾）
    await sendAlertsIfNeeded(overallStatus, alertService, consecutiveFailures);

    // 自動自癒：PM2 errored 時不等人工，直接 restart
    await autoHealIfNeeded(overallStatus);

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
        { error: err.stack },
        'health-check-crash'
      );
    } catch (alertErr) {
      console.error('Failed to send crash alert:', alertErr.message);
    }

    process.exit(1);
  }
}

// 執行
main();
