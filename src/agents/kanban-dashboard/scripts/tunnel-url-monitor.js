#!/usr/bin/env node
/**
 * tunnel-url-monitor.js - Cloudflare Tunnel URL 監控
 *
 * 功能：
 * 1. 讀取本地 data/tunnel-url.txt（由 start-tunnel.sh 維護）
 * 2. 查詢 Telegram getWebhookInfo（當前設定）
 * 3. 比對基礎 URL
 * 4. 不一致時呼叫 update-webhook.sh 更新
 *
 * 執行頻率：Cron 每分鐘
 * 日誌格式：JSON Lines (便於解析)
 *
 * 環境變數：
 *   TELEGRAM_BOT_TOKEN - Bot 認證 token（可選，有預設值）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ==================== 配置 ====================

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');

const TUNNEL_URL_FILE = path.join(DATA_DIR, 'tunnel-url.txt');
const MONITOR_LOG = path.join(LOG_DIR, 'tunnel-monitor.log');
const UPDATE_WEBHOOK_SCRIPT = path.join(SCRIPTS_DIR, 'update-webhook.sh');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ||
  'REDACTED_TOKEN';

// ==================== 日誌函數 ====================

/**
 * 記錄結構化日誌（JSON Lines 格式）
 */
function log(level, message, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...details
  };

  // 寫入檔案（JSON Lines 格式）
  try {
    fs.appendFileSync(MONITOR_LOG, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('Failed to write log:', err.message);
  }

  // 同時輸出到 console（便於 PM2/cron 查看）
  const emoji = {
    'INFO': 'ℹ️ ',
    'WARN': '⚠️ ',
    'ERROR': '❌'
  }[level] || '';

  console.log(`[${logEntry.timestamp}] ${emoji}${level}: ${message}`);
  if (Object.keys(details).length > 0) {
    console.log('   Details:', JSON.stringify(details, null, 2));
  }
}

// ==================== 核心函數 ====================

/**
 * 讀取本地 Tunnel URL
 */
function readLocalTunnelUrl() {
  try {
    if (!fs.existsSync(TUNNEL_URL_FILE)) {
      log('WARN', 'Local tunnel URL file not found', {
        file: TUNNEL_URL_FILE,
        note: 'Waiting for tunnel to start'
      });
      return null;
    }

    const url = fs.readFileSync(TUNNEL_URL_FILE, 'utf8').trim();

    if (!url) {
      log('WARN', 'Local tunnel URL file is empty', { file: TUNNEL_URL_FILE });
      return null;
    }

    // 簡單驗證格式
    if (!url.match(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/)) {
      log('WARN', 'Local tunnel URL format unexpected', { url });
    }

    return url;
  } catch (err) {
    log('ERROR', 'Failed to read local tunnel URL', {
      error: err.message,
      file: TUNNEL_URL_FILE
    });
    return null;
  }
}

/**
 * 查詢 Telegram Webhook Info
 */
function getTelegramWebhookInfo() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/getWebhookInfo`,
      method: 'GET',
      timeout: 10000
    }, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);

          if (!result.ok) {
            reject(new Error(`Telegram API error: ${JSON.stringify(result)}`));
            return;
          }

          resolve(result.result);
        } catch (err) {
          reject(new Error(`JSON parse error: ${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`HTTP request error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP request timeout (10s)'));
    });

    req.end();
  });
}

/**
 * 從 webhook URL 提取基礎 URL
 *
 * @param {string} webhookUrl - 完整 webhook URL
 * @returns {string|null} - 基礎 URL 或 null
 *
 * @example
 * extractBaseUrl('https://abc.trycloudflare.com/api/telegram/webhook')
 * // => 'https://abc.trycloudflare.com'
 */
function extractBaseUrl(webhookUrl) {
  if (!webhookUrl) return null;

  const match = webhookUrl.match(/^(https:\/\/[^\/]+)/);
  return match ? match[1] : null;
}

/**
 * 呼叫 update-webhook.sh 更新 webhook
 */
function updateWebhook(tunnelUrl) {
  try {
    log('INFO', 'Calling update-webhook.sh', { tunnelUrl });

    const command = `bash "${UPDATE_WEBHOOK_SCRIPT}" "${tunnelUrl}"`;

    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 15000,  // 15 秒超時
      stdio: ['pipe', 'pipe', 'pipe']
    });

    log('INFO', 'Webhook updated successfully', {
      output: output.trim().split('\n').slice(-3).join('\n')  // 只記錄最後 3 行
    });

    return true;
  } catch (err) {
    log('ERROR', 'Failed to update webhook', {
      error: err.message,
      exitCode: err.status,
      stderr: err.stderr?.toString().trim(),
      stdout: err.stdout?.toString().trim()
    });

    return false;
  }
}

// ==================== 主邏輯 ====================

async function main() {
  log('INFO', '🔍 Starting tunnel URL monitor check');

  try {
    // 1. 讀取本地 URL
    const localUrl = readLocalTunnelUrl();

    if (!localUrl) {
      log('WARN', 'No local tunnel URL available, skipping check');
      process.exit(0);
    }

    log('INFO', 'Local tunnel URL', { url: localUrl });

    // 2. 查詢 Telegram webhook info
    const webhookInfo = await getTelegramWebhookInfo();
    const currentWebhookUrl = webhookInfo.url;
    const currentBaseUrl = extractBaseUrl(currentWebhookUrl);

    log('INFO', 'Current webhook info', {
      webhookUrl: currentWebhookUrl || '(not set)',
      baseUrl: currentBaseUrl || '(not set)',
      pendingUpdates: webhookInfo.pending_update_count,
      lastErrorDate: webhookInfo.last_error_date || 'none',
      lastErrorMessage: webhookInfo.last_error_message || 'none'
    });

    // 3. 比對 URL
    if (currentBaseUrl === localUrl) {
      log('INFO', '✅ URLs match, no update needed');
      process.exit(0);
    }

    // 4. URL 不一致，執行更新
    log('WARN', '⚠️  URL mismatch detected', {
      local: localUrl,
      remote: currentBaseUrl || '(not set)',
      action: 'updating webhook'
    });

    const success = updateWebhook(localUrl);

    if (success) {
      log('INFO', '✅ Monitor check completed successfully');
      process.exit(0);
    } else {
      log('ERROR', '❌ Monitor check failed', {
        reason: 'webhook update failed'
      });
      process.exit(1);
    }
  } catch (err) {
    log('ERROR', 'Monitor check error', {
      error: err.message,
      stack: err.stack
    });
    process.exit(1);
  }
}

// 執行主邏輯
main();
