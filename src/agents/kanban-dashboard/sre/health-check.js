// SRE Health Check System for Kanban Dashboard
// 定期檢查系統各組件健康狀態

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');

class HealthCheckSystem {
  constructor(options = {}) {
    this.checks = new Map();
    this.lastResults = new Map();
    this.healthHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * 註冊健康檢查
   */
  register(name, checkFn, options = {}) {
    this.checks.set(name, {
      name,
      checkFn,
      critical: options.critical !== false, // 預設為 critical
      timeout: options.timeout || 5000,
      interval: options.interval || 60000 // 預設每分鐘檢查
    });
  }

  /**
   * 執行單個健康檢查
   */
  async runCheck(name) {
    const check = this.checks.get(name);
    if (!check) {
      throw new Error(`Health check '${name}' not found`);
    }

    const startTime = Date.now();

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
      );

      const checkPromise = check.checkFn();
      const result = await Promise.race([checkPromise, timeoutPromise]);

      const duration = Date.now() - startTime;

      const checkResult = {
        name,
        status: 'HEALTHY',
        critical: check.critical,
        timestamp: new Date().toISOString(),
        duration,
        details: result || {}
      };

      this.lastResults.set(name, checkResult);
      return checkResult;
    } catch (err) {
      const duration = Date.now() - startTime;

      const checkResult = {
        name,
        status: 'UNHEALTHY',
        critical: check.critical,
        timestamp: new Date().toISOString(),
        duration,
        error: err.message,
        details: {}
      };

      this.lastResults.set(name, checkResult);
      return checkResult;
    }
  }

  /**
   * 執行所有健康檢查
   */
  async runAll() {
    console.log('🏥 執行健康檢查...\n');

    const results = [];
    for (const name of this.checks.keys()) {
      const result = await this.runCheck(name);
      results.push(result);
    }

    // 計算整體健康狀態
    const overallStatus = this.calculateOverallStatus(results);

    // 記錄到歷史
    this.recordHistory(overallStatus);

    // 顯示報告
    this.displayReport(results, overallStatus);

    return overallStatus;
  }

  /**
   * 計算整體健康狀態
   */
  calculateOverallStatus(results) {
    const healthy = results.filter(r => r.status === 'HEALTHY').length;
    const unhealthy = results.filter(r => r.status === 'UNHEALTHY').length;
    const criticalUnhealthy = results.filter(r => r.status === 'UNHEALTHY' && r.critical).length;

    let status = 'HEALTHY';
    if (criticalUnhealthy > 0) {
      status = 'CRITICAL';
    } else if (unhealthy > 0) {
      status = 'DEGRADED';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        total: results.length,
        healthy,
        unhealthy,
        criticalUnhealthy
      },
      results
    };
  }

  /**
   * 記錄歷史
   */
  recordHistory(overallStatus) {
    this.healthHistory.push(overallStatus);

    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
  }

  /**
   * 顯示報告
   */
  displayReport(results, overallStatus) {
    console.log('='.repeat(60));
    console.log('🏥 Health Check Report');
    console.log('='.repeat(60));
    console.log(`Overall Status: ${this.getStatusEmoji(overallStatus.status)} ${overallStatus.status}`);
    console.log(`Timestamp: ${overallStatus.timestamp}`);
    console.log('');

    // 顯示各項檢查
    for (const result of results) {
      const emoji = result.status === 'HEALTHY' ? '✅' : '❌';
      const criticalLabel = result.critical ? '[CRITICAL]' : '[OPTIONAL]';
      console.log(`${emoji} ${criticalLabel} ${result.name}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Duration: ${result.duration}ms`);

      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }

      if (Object.keys(result.details).length > 0) {
        console.log(`   Details:`, JSON.stringify(result.details, null, 2).split('\n').map((l, i) => i === 0 ? l : `            ${l}`).join('\n'));
      }
      console.log('');
    }

    console.log('='.repeat(60));
    console.log(`Summary: ${overallStatus.checks.healthy}/${overallStatus.checks.total} checks passed`);

    if (overallStatus.checks.criticalUnhealthy > 0) {
      console.log(`⚠️  ${overallStatus.checks.criticalUnhealthy} CRITICAL checks failed!`);
    }

    console.log('='.repeat(60) + '\n');
  }

  /**
   * 取得狀態 emoji
   */
  getStatusEmoji(status) {
    const map = {
      'HEALTHY': '🟢',
      'DEGRADED': '🟡',
      'CRITICAL': '🔴'
    };
    return map[status] || '⚪';
  }

  /**
   * 取得最近的健康狀態
   */
  getRecentHistory(count = 10) {
    return this.healthHistory.slice(-count);
  }

  /**
   * 取得當前狀態
   */
  getCurrentStatus() {
    if (this.healthHistory.length === 0) {
      return null;
    }
    return this.healthHistory[this.healthHistory.length - 1];
  }
}

/**
 * 註冊 Kanban Dashboard 專用的健康檢查項目
 */
function registerKanbanDashboardChecks(healthCheck) {
  // 1. 檢查 Telegram Health Endpoint
  healthCheck.register('telegram-health', async () => {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3001,
        path: '/api/telegram/health',
        method: 'GET',
        timeout: 12000  // 小於 check timeout(15000)，確保 req timeout 先觸發
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode === 200 && result.status === 'ok') {
              resolve({
                statusCode: res.statusCode,
                telegram_api: result.checks?.telegram_api || 'ok',
                botName: result.checks?.botName || 'unknown'
              });
            } else if (res.statusCode === 200 && result.status === 'degraded') {
              // Telegram API 有問題但 health endpoint 正常 → 標記為 UNHEALTHY
              reject(new Error(`Telegram API degraded: ${result.checks?.telegramError || 'unknown'}`));
            } else {
              reject(new Error(`HTTP ${res.statusCode}, status: ${result.status || 'unknown'}`));
            }
          } catch (err) {
            reject(new Error(`Parse error: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        req.destroy();
        reject(err);
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }, { critical: false, timeout: 15000 });  // critical: false — Telegram 連通性不是系統 CRITICAL

  // 2. 檢查 PM2 進程狀態
  healthCheck.register('pm2-status', async () => {
    try {
      const output = execSync('pm2 jlist', {
        encoding: 'utf8',
        timeout: 5000
      });

      const processes = JSON.parse(output);
      const dashboard = processes.find(p => p.name === 'kanban-dashboard');

      if (!dashboard) {
        throw new Error('kanban-dashboard process not found in PM2');
      }

      if (dashboard.pm2_env.status !== 'online') {
        throw new Error(`kanban-dashboard status: ${dashboard.pm2_env.status}`);
      }

      return {
        status: dashboard.pm2_env.status,
        uptime: `${Math.floor(dashboard.pm2_env.pm_uptime / 1000 / 60)} minutes`,
        restarts: dashboard.pm2_env.restart_time,
        memory: `${(dashboard.monit.memory / 1024 / 1024).toFixed(2)} MB`
      };
    } catch (err) {
      throw new Error(`PM2 check failed: ${err.message}`);
    }
  }, { critical: true, timeout: 6000 });

  // 3. 檢查 Cloudflare Tunnel 進程
  healthCheck.register('cloudflare-tunnel', async () => {
    try {
      const output = execSync('pgrep -f cloudflared', {
        encoding: 'utf8',
        timeout: 3000
      });

      const pids = output.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        throw new Error('No cloudflared process found');
      }

      return {
        processCount: pids.length,
        pids: pids.join(', ')
      };
    } catch (err) {
      if (err.status === 1) {
        throw new Error('Cloudflare Tunnel not running (pgrep returned no results)');
      }
      throw new Error(`Tunnel check failed: ${err.message}`);
    }
  }, { critical: true, timeout: 4000 });

  // 4. 驗證 Telegram Webhook URL
  healthCheck.register('webhook-url', async () => {
    return new Promise((resolve, reject) => {
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'REDACTED_TOKEN';

      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/getWebhookInfo`,
        method: 'GET',
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (!result.ok) {
              reject(new Error('Telegram API returned not ok'));
              return;
            }

            const webhookUrl = result.result.url;
            const pendingCount = result.result.pending_update_count;

            // 檢查是否有設定 webhook
            if (!webhookUrl) {
              reject(new Error('No webhook URL configured'));
              return;
            }

            // 檢查是否有錯誤
            if (result.result.last_error_message) {
              console.warn(`⚠️  Last webhook error: ${result.result.last_error_message}`);
            }

            resolve({
              url: webhookUrl,
              pendingUpdates: pendingCount,
              lastErrorDate: result.result.last_error_date || 'none'
            });
          } catch (err) {
            reject(new Error(`Parse error: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }, { critical: false, timeout: 12000 });

  // 5. 檢查記憶體使用
  healthCheck.register('memory', async () => {
    const usage = process.memoryUsage();
    const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (usage.rss / 1024 / 1024).toFixed(2);

    // 警告：heap 使用超過 100MB（Kanban Dashboard 的記憶體限制是 150MB）
    if (usage.heapUsed > 100 * 1024 * 1024) {
      throw new Error(`High memory usage: ${heapUsedMB} MB (limit: 150 MB)`);
    }

    return {
      heapUsed: `${heapUsedMB} MB`,
      heapTotal: `${heapTotalMB} MB`,
      rss: `${rssMB} MB`
    };
  }, { critical: false, timeout: 1000 });

  // 6. 檢查執行時間
  healthCheck.register('uptime', async () => {
    const uptimeSeconds = process.uptime();
    const uptimeMinutes = (uptimeSeconds / 60).toFixed(2);

    // INFO：如果運行時間少於 5 分鐘，表示剛重啟
    if (uptimeSeconds < 300) {
      return {
        uptime: `${uptimeMinutes} minutes`,
        pid: process.pid,
        recentRestart: true
      };
    }

    return {
      uptime: `${uptimeMinutes} minutes`,
      pid: process.pid,
      recentRestart: false
    };
  }, { critical: false, timeout: 500 });
}

// 建立實例
function createHealthCheckSystem() {
  const healthCheck = new HealthCheckSystem();
  registerKanbanDashboardChecks(healthCheck);
  return healthCheck;
}

module.exports = {
  HealthCheckSystem,
  registerKanbanDashboardChecks,
  createHealthCheckSystem
};
