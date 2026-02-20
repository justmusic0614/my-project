/**
 * TelegramPublisher — Telegram 推播器
 * 負責：
 *   - 將 Daily Brief / 週報推播到 Telegram 頻道
 *   - 處理多訊息分頁（透過 TelegramFormatter）
 *   - 重試機制（最多 3 次，指數退避）
 *   - Dry-run 模式（不實際發送，只記錄）
 *
 * API: Telegram Bot API sendMessage
 * 限速: 30 msg/sec（bot），1 msg/sec to same chat
 */

'use strict';

const https  = require('https');
const { createLogger } = require('../shared/logger');
const formatter = require('../renderers/telegram-formatter');
const costLedger = require('../shared/cost-ledger');

const logger = createLogger('publisher:telegram');

const RETRY_DELAYS = [1000, 3000, 9000]; // 指數退避（ms）
const SEND_INTERVAL = 1200;              // 同 chat 訊息間隔 1.2s

class TelegramPublisher {
  constructor(config = {}) {
    this.botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId   = config.chatId   || process.env.TELEGRAM_CHAT_ID   || '';
    this.enabled  = !!(this.botToken && this.chatId);
    this.dryRun   = config.dryRun   || false;
    this.maxLen   = config.maxMessageLength || 4000;
  }

  /**
   * 推播 Daily Brief
   * @param {string} briefText - 完整報告文字
   * @returns {Promise<{ sent: number, failed: number }>}
   */
  async publishDailyBrief(briefText) {
    return this._publishText(briefText, 'daily-brief');
  }

  /**
   * 推播週報
   */
  async publishWeeklyReport(reportText) {
    return this._publishText(reportText, 'weekly-report');
  }

  /**
   * 推播告警訊息（不分頁，直接發）
   * @param {string} alertText - 已格式化的告警文字
   */
  async publishAlert(alertText) {
    if (!this.enabled && !this.dryRun) {
      logger.warn('Telegram not configured, alert skipped');
      return { sent: 0, failed: 0 };
    }
    return this._sendMessage(alertText);
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  async _publishText(text, label) {
    if (!text || text.trim().length === 0) {
      logger.warn(`empty text for ${label}, skipping`);
      return { sent: 0, failed: 0 };
    }

    if (!this.enabled && !this.dryRun) {
      logger.warn('Telegram not configured');
      return { sent: 0, failed: 0 };
    }

    const parts = formatter.splitReport(text, { maxLen: this.maxLen });
    logger.info(`publishing ${label}: ${parts.length} part(s), total ${text.length} chars`);

    let sent = 0, failed = 0;

    for (const [i, part] of parts.entries()) {
      if (i > 0) await this._sleep(SEND_INTERVAL); // 間隔避免限速

      const result = await this._sendWithRetry(part);
      if (result.ok) {
        sent++;
        costLedger.recordApiCall('telegram', 1);
      } else {
        failed++;
        logger.error(`send failed for part ${i + 1}/${parts.length}: ${result.error}`);
      }
    }

    logger.info(`${label} publish complete: sent=${sent} failed=${failed}`);
    return { sent, failed };
  }

  async _sendWithRetry(text) {
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      // 最後一次嘗試：降級為純文字模式（Markdown fallback）
      // 若前幾次因 "can't parse entities" 失敗，純文字模式可確保訊息送出
      const parseMode = attempt < RETRY_DELAYS.length ? 'Markdown' : '';
      try {
        await this._sendMessage(text, parseMode);
        if (parseMode === '') logger.warn('sent without Markdown formatting (parse fallback)');
        return { ok: true };
      } catch (err) {
        if (attempt < RETRY_DELAYS.length) {
          logger.warn(`send attempt ${attempt + 1} failed: ${err.message}, retrying in ${RETRY_DELAYS[attempt]}ms`);
          await this._sleep(RETRY_DELAYS[attempt]);
        } else {
          return { ok: false, error: err.message };
        }
      }
    }
    return { ok: false, error: 'max retries exceeded' };
  }

  async _sendMessage(text, parseMode = 'Markdown') {
    if (this.dryRun) {
      logger.info(`[DRY-RUN] Would send (parseMode=${parseMode || 'none'}) to ${this.chatId} (${text.length} chars):\n${text.slice(0, 200)}...`);
      return;
    }

    return new Promise((resolve, reject) => {
      const bodyObj = { chat_id: this.chatId, text };
      if (parseMode) bodyObj.parse_mode = parseMode;
      const body = JSON.stringify(bodyObj);

      const options = {
        hostname: 'api.telegram.org',
        port:     443,
        path:     `/bot${this.botToken}/sendMessage`,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 15000
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) {
              resolve(json);
            } else {
              reject(new Error(`Telegram API error: ${json.description || JSON.stringify(json)}`));
            }
          } catch (e) {
            reject(new Error(`JSON parse: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TelegramPublisher;
