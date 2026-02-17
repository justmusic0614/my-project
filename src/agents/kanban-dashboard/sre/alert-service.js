// Alert Service for Kanban Dashboard
// 透過 Telegram Bot API 發送告警通知

const fs = require('fs');
const path = require('path');
const https = require('https');

// 告警狀態持久化檔案（解決 cron 每次重建實例導致 cooldown 失效的問題）
const ALERT_STATE_FILE = path.join(__dirname, '../logs/health/alert-state.json');

class AlertService {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = options.chatId || process.env.TELEGRAM_ALERT_CHAT_ID;
    this.cooldownMs = options.cooldownMs || 15 * 60 * 1000; // 15 分鐘（從 5 分鐘改為 15 分鐘）
    this.recentAlerts = new Map();

    // 讀取持久化的告警狀態（解決 cron 重建實例問題）
    this._loadState();
  }

  /**
   * 從檔案載入告警狀態（cooldown 持久化）
   */
  _loadState() {
    try {
      if (fs.existsSync(ALERT_STATE_FILE)) {
        const saved = JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf8'));
        const now = Date.now();

        // 還原 recentAlerts（過濾掉已過期的）
        for (const [key, ts] of Object.entries(saved.recentAlerts || {})) {
          if (now - ts < this.cooldownMs) {
            this.recentAlerts.set(key, ts);
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

    // 格式化訊息
    const formattedMessage = this.formatMessage(message, level, details);

    try {
      await this.sendTelegramMessage(formattedMessage);

      // 記錄此告警，防止短時間內重複發送
      this.recentAlerts.set(alertKey, Date.now());

      // 持久化狀態（確保 cron 下次執行時 cooldown 仍有效）
      this._saveState();

      console.log(`[Alert] Sent ${level} alert successfully`);
      return { success: true, level, message };
    } catch (err) {
      console.error(`[Alert] Failed to send alert:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * 檢查是否應該跳過此告警（防止告警風暴）
   */
  shouldSkipAlert(alertKey) {
    const lastSent = this.recentAlerts.get(alertKey);
    if (!lastSent) {
      return false;
    }

    const elapsed = Date.now() - lastSent;
    if (elapsed < this.cooldownMs) {
      const remainingMinutes = Math.ceil((this.cooldownMs - elapsed) / 60000);
      console.log(`[Alert] Cooldown active, ${remainingMinutes} min remaining for: ${alertKey}`);
      return true; // 冷卻時間內，跳過
    }

    // 超過冷卻時間，移除舊記錄
    this.recentAlerts.delete(alertKey);
    return false;
  }

  /**
   * 格式化訊息
   */
  formatMessage(message, level, details) {
    const emoji = this.getLevelEmoji(level);
    const timestamp = new Date().toISOString();

    let formatted = `${emoji} *${level} Alert*\n\n`;
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
   * 清理過期的告警記錄
   */
  cleanup() {
    const now = Date.now();
    for (const [key, timestamp] of this.recentAlerts.entries()) {
      if (now - timestamp > this.cooldownMs * 2) {
        this.recentAlerts.delete(key);
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
