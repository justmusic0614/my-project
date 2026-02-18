/**
 * AlertPublisher — 告警推播器
 * 負責：Pipeline 失敗、驗證異常、預算超支等告警推播
 *
 * 告警層級：
 *   CRITICAL — pipeline 完全失敗（所有來源均無數據）
 *   ERROR    — 某 phase 失敗 / 多欄位降級
 *   WARNING  — 交叉比對失敗 / 單欄位降級 / API 配額低
 *   INFO     — 成本超 80% / 排程完成
 *
 * 冷卻機制：同類告警 30 分鐘內不重複發送
 */

'use strict';

const { createLogger } = require('../shared/logger');
const formatter = require('../renderers/telegram-formatter');

const logger = createLogger('publisher:alert');

const COOLDOWN_MS = 30 * 60 * 1000; // 30 分鐘

class AlertPublisher {
  /**
   * @param {TelegramPublisher} telegramPublisher - 已初始化的 TelegramPublisher 實例
   * @param {object} config
   * @param {number} config.cooldownMs - 告警冷卻時間（ms），預設 30 分鐘
   */
  constructor(telegramPublisher, config = {}) {
    this.telegram   = telegramPublisher;
    this.cooldownMs = config.cooldownMs || COOLDOWN_MS;
    this._lastSent  = new Map(); // alertKey → timestamp
  }

  /**
   * Pipeline 階段失敗告警
   * @param {string} phase   - 'phase1' | 'phase2' | 'phase3' | 'phase4'
   * @param {Error}  error
   * @param {object} context
   */
  async pipelineFailed(phase, error, context = {}) {
    const key  = `pipeline-failed-${phase}`;
    const text = formatter.formatDegradedAlert(phase, {
      error:   error?.message || 'unknown error',
      message: context.message
    });
    return this._send(key, text, 'ERROR');
  }

  /**
   * 多欄位資料降級告警
   * @param {string[]} degradedFields - 降級欄位清單
   * @param {number}   threshold      - 觸發告警的最低降級數（預設 5）
   */
  async degradationAlert(degradedFields = [], threshold = 5) {
    if (degradedFields.length < threshold) return;
    const key  = `degradation-${degradedFields.slice(0, 3).join('-')}`;
    const text = formatter.formatAlert(
      '資料降級告警',
      `${degradedFields.length} 個欄位降級：\n${degradedFields.slice(0, 10).join(', ')}`,
      'WARNING'
    );
    return this._send(key, text, 'WARNING');
  }

  /**
   * 驗證交叉比對失敗告警
   * @param {string[]} warnings - crossCheckWarnings 陣列
   */
  async crossCheckAlert(warnings = []) {
    if (warnings.length === 0) return;
    const key  = 'cross-check-fail';
    const text = formatter.formatAlert(
      '交叉比對失敗',
      warnings.slice(0, 5).join('\n'),
      'WARNING'
    );
    return this._send(key, text, 'WARNING');
  }

  /**
   * 預算超支告警
   * @param {object} budget - { totalCost, budget, pct }
   */
  async budgetAlert(budget) {
    const pct = ((budget.totalCost / budget.budget) * 100).toFixed(1);
    const level = budget.totalCost >= budget.budget ? 'ERROR' : 'WARNING';
    const key   = `budget-${level}`;
    const text  = formatter.formatAlert(
      `成本${level === 'ERROR' ? '超支' : '警告'}`,
      `今日成本 $${budget.totalCost.toFixed(4)}（${pct}% of $${budget.budget} 預算）`,
      level
    );
    return this._send(key, text, level);
  }

  /**
   * 完全無數據的極端降級告警（推播簡短告警訊息）
   * @param {string} date
   */
  async criticalNoData(date) {
    const key  = `critical-no-data-${date}`;
    const text = formatter.formatAlert(
      '⛔ 嚴重：所有資料源失敗',
      `${date} 日報無法生成，所有市場數據收集失敗。請檢查 API 狀態與網路連線。`,
      'ERROR'
    );
    return this._send(key, text, 'CRITICAL');
  }

  /**
   * Pipeline 成功完成通知（INFO 等級，有節流）
   * @param {object} summary - { date, duration, cost, degraded }
   */
  async pipelineSuccess(summary) {
    const key  = `pipeline-ok-${summary.date}`;
    const text = formatter.formatAlert(
      '✅ Pipeline 完成',
      [
        `日期: ${summary.date}`,
        `耗時: ${Math.round((summary.duration || 0) / 1000)}s`,
        summary.cost    != null ? `成本: $${summary.cost.toFixed(4)}` : null,
        summary.degraded > 0 ? `降級: ${summary.degraded} 欄位` : null
      ].filter(Boolean).join('\n'),
      'INFO'
    );
    return this._send(key, text, 'INFO');
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  async _send(alertKey, text, level) {
    // 冷卻檢查
    const lastSent = this._lastSent.get(alertKey) || 0;
    if (Date.now() - lastSent < this.cooldownMs) {
      logger.debug(`alert cooldown active for: ${alertKey}`);
      return { skipped: true, reason: 'cooldown' };
    }

    logger.warn(`[${level}] ${alertKey}`);
    this._lastSent.set(alertKey, Date.now());

    if (!this.telegram) {
      logger.warn('no telegram publisher, alert logged only');
      return { sent: false, reason: 'no_telegram' };
    }

    try {
      await this.telegram.publishAlert(text);
      return { sent: true };
    } catch (err) {
      logger.error(`alert send failed: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }
}

module.exports = AlertPublisher;
