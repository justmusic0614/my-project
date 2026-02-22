// Alert Service for Kanban Dashboard
// 透過 Telegram Bot API 發送告警通知

const fs = require('fs');
const path = require('path');
const https = require('https');

// 告警狀態持久化檔案（解決 cron 每次重建實例導致 cooldown 失效的問題）
const ALERT_STATE_FILE = path.join(__dirname, '../logs/health/alert-state.json');

// 指數退避冷卻設定（避免持續性 DEGRADED 告警轟炸）
const BACKOFF_THRESHOLDS = [
  { minAlerts: 7, cooldownMs: 2 * 60 * 60 * 1000 }, // 7+ 次 → 2 小時
  { minAlerts: 4, cooldownMs: 30 * 60 * 1000 },      // 4-6 次 → 30 分鐘
  { minAlerts: 0, cooldownMs: 15 * 60 * 1000 }        // 1-3 次 → 15 分鐘（基礎）
];

class AlertService {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = options.chatId || process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
    this.baseCooldownMs = options.cooldownMs || 15 * 60 * 1000; // 15 分鐘基礎冷卻
    this.recentAlerts = new Map();
    this.consecutiveAlerts = {}; // { alertKey: count } 連續告警計數

    // 讀取持久化的告警狀態（解決 cron 重建實例問題）
    this._loadState();
  }

  /**
   * 根據連續告警次數計算實際冷卻時間（指數退避）
   */
  _getCooldownMs(alertKey) {
    const count = this.consecutiveAlerts[alertKey] || 0;
    for (const { minAlerts, cooldownMs } of BACKOFF_THRESHOLDS) {
      if (count >= minAlerts) {
        return cooldownMs;
      }
    }
    return this.baseCooldownMs;
  }

  /**
   * 從檔案載入告警狀態（cooldown 持久化）
   */
  _loadState() {
    try {
      if (fs.existsSync(ALERT_STATE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf8'));
        const now = Date.now();

        // 還原 consecutiveAlerts
        this.consecutiveAlerts = saved.consecutiveAlerts || {};

        // 還原 recentAlerts（過濾掉已過期的，使用各自的冷卻時間判斷）
        for (const [key, ts] of Object.entries(saved.recentAlerts || {})) {
          const cooldownMs = this._getCooldownMs(key);
          if (now - ts < cooldownMs) {
            this.recentAlerts.set(key, ts);
          } else {
            // 冷卻已過期，重置連續計數
            delete this.consecutiveAlerts[key];
          }
        }

        if (this.recentAlerts.size > 0) {
          console.log(`[Alert] Loaded ${this.recentAlerts.size} active cooldown(s) from state file`);
        }
      }
    } catch (err) {
      console.warn(`[Alert] Could not load state: ${err.message}`);
    }
  }

  /**
   * 儲存告警狀態到檔案（確保 cron 下次執行時 cooldown 仍有效）
   */
  _saveState() {
    try {
      const dir = path.dirname(ALERT_STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const state = {
        recentAlerts: Object.fromEntries(this.recentAlerts),
        consecutiveAlerts: this.consecutiveAlerts,
        savedAt: new Date().toISOString()
      };

      fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.warn(`[Alert] Could not save state: ${err.message}`);
    }
  }

  /**
   * 發送告警訊息
   * @param {string} message - 告警訊息
   * @param {string} level - 嚴重度 (INFO, WARNING, ERROR, CRITICAL)
   * @param {object} details - 額外詳細資訊
   * @param {string} alertType - 固定的告警類型（用於 cooldown key，避免動態 message 導致 cooldown 失效）
   */
  async sendAlert(message, level = 'INFO', details = {}, alertType = 'default') {
    // 使用固定的 alertType 作為 cooldown key（不包含動態 message）
    const alertKey = `${level}:${alertType}`;

    if (this.shouldSkipAlert(alertKey)) {
      console.log(`[Alert] Skipping duplicate alert (cooldown): ${alertKey}`);
      return { skipped: true, reason: 'cooldown' };
    }

    // 格式化訊息（附上連續告警次數，讓收件人了解嚴重程度）
    const count = (this.consecutiveAlerts[alertKey] || 0) + 1;
    const formattedMessage = this.formatMessage(message, level, details, count);

    try {
      await this.sendTelegramMessage(formattedMessage);

      // 更新連續告警計數和發送時間
      this.consecutiveAlerts[alertKey] = count;
      this.recentAlerts.set(alertKey, Date.now());

      // 持久化狀態（確保 cron 下次執行時 cooldown 仍有效）
      this._saveState();

      const cooldownMs = this._getCooldownMs(alertKey);
      console.log(`[Alert] Sent ${level} alert #${count} (next cooldown: ${cooldownMs / 60000} min)`);
      return { success: true, level, message, alertCount: count };
    } catch (err) {
      console.error(`[Alert] Failed to send alert:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 檢查是否應該跳過此告警（防止告警風暴，含指數退避）
   */
  shouldSkipAlert(alertKey) {
    const lastSent = this.recentAlerts.get(alertKey);
    if (!lastSent) {
      return false;
    }

    const elapsed = Date.now() - lastSent;
    const cooldownMs = this._getCooldownMs(alertKey);

    if (elapsed < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsed) / 60000);
      const count = this.consecutiveAlerts[alertKey] || 0;
      console.log(`[Alert] Cooldown active (${remainingMinutes} min remaining, alert #${count}): ${alertKey}`);
      return true; // 冷卻時間內，跳過
    }

    // 超過冷卻時間，移除舊記錄（但保留 consecutiveAlerts 計數，等待狀態恢復才重置）
    this.recentAlerts.delete(alertKey);
    return false;
  }

  /**
   * 發送恢復通知（系統回到 HEALTHY 時呼叫，重置連續計數）
   */
  resetConsecutiveAlerts(alertKey) {
    if (this.consecutiveAlerts[alertKey]) {
      console.log(`[Alert] Resetting consecutive count for ${alertKey} (was: ${this.consecutiveAlerts[alertKey]})`);
      delete this.consecutiveAlerts[alertKey];
      this._saveState();
    }
  }

  /**
   * 格式化訊息
   */
  formatMessage(message, level, details, alertCount = null) {
    const emoji = this.getLevelEmoji(level);
    const timestamp = new Date().toISOString();

    let formatted = `${emoji} *${level} Alert*`;
    if (alertCount && alertCount > 1) {
      formatted += ` _(#${alertCount})_`;
    }
    formatted += `\n\n`;
    formatted += `📋 ${message}\n\n`;
    formatted += `🕐 Time: \`${timestamp}\`\n`;

    if (Object.keys(details).length > 0) {
      formatted += '\n📊 Details:\n';
      for (const [key, value] of Object.entries(details)) {
        formatted += `• ${key}: \`${JSON.stringify(value)}\`\n`;
      }
    }

    formatted += '\n━━━━━━━━━━━━━━━━━━\n';
    formatted += '🤖 *Kanban Dashboard SRE*';

    return formatted;
  }

  /**
   * 取得嚴重度對應的 emoji
   */
  getLevelEmoji(level) {
    const map = {
      'INFO': '💡',
      'WARNING': '⚠️',
      'ERROR': '❌',
      'CRITICAL': '🔴'
    };
    return map[level] || '📢';
  }

  /**
   * 透過 Telegram Bot API 發送訊息
   */
  sendTelegramMessage(text) {
    return new Promise((resolve, reject) => {
      if (!this.botToken || !this.chatId) {
        reject(new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_ALERT_CHAT_ID'));
        return;
      }

      const data = JSON.stringify({
        chat_id: this.chatId,
        text: text,
        parse_mode: 'Markdown'
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        },
        timeout: 10000
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true, statusCode: res.statusCode });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * 清理過期的告警記錄（同時重置長時間無活動的連續計數）
   */
  cleanup() {
    const now = Date.now();
    const maxCooldownMs = 2 * 60 * 60 * 1000; // 2 小時（最長退避時間）

    for (const [key, timestamp] of this.recentAlerts.entries()) {
      if (now - timestamp > maxCooldownMs * 2) {
        this.recentAlerts.delete(key);
        delete this.consecutiveAlerts[key]; // 一起清除連續計數
      }
    }
    this._saveState();
  }
}

/**
 * 建立 AlertService 實例
 */
function createAlertService(options = {}) {
  return new AlertService(options);
}

module.exports = {
  AlertService,
  createAlertService
};
