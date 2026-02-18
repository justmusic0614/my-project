/**
 * TelegramFormatter — Telegram 訊息格式化與分割
 * 負責：
 *   1. 將長文字報告切割為 Telegram ≤4000 字元的訊息片段
 *   2. 保持語意完整性（不在段落中間切斷）
 *   3. 標記「第 N/M 則」的分頁提示
 *   4. 特殊格式：alert 訊息（簡短、帶時間戳）
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('renderer:telegram-formatter');

const MAX_MSG_LEN = 4000;   // Telegram Bot API 上限 4096，留 96 緩衝
const PART_LABEL  = (n, total) => `\n[${n}/${total}]`;

class TelegramFormatter {
  /**
   * 將完整報告文字切割為 Telegram 訊息陣列
   * @param {string} text - 完整報告文字
   * @param {object} opts
   * @param {number} opts.maxLen - 每則訊息上限（預設 MAX_MSG_LEN）
   * @returns {string[]} Telegram 訊息陣列
   */
  splitReport(text, opts = {}) {
    const maxLen = opts.maxLen || MAX_MSG_LEN;

    if (!text || text.length === 0) return [];
    if (text.length <= maxLen) return [text];

    const parts = this._splitByParagraph(text, maxLen);

    // 加上分頁標記（只有超過 1 則才加）
    if (parts.length > 1) {
      return parts.map((p, i) => p + PART_LABEL(i + 1, parts.length));
    }
    return parts;
  }

  /**
   * 格式化告警訊息（簡短、帶時間戳）
   * @param {string} title   - 告警標題
   * @param {string} body    - 告警內容
   * @param {string} level   - 'ERROR' | 'WARNING' | 'INFO'
   * @returns {string}
   */
  formatAlert(title, body, level = 'WARNING') {
    const emoji = { ERROR: '🚨', WARNING: '⚠️', INFO: 'ℹ️' }[level] || '⚠️';
    const ts    = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    return `${emoji} ${title}\n${ts}\n\n${body}`;
  }

  /**
   * 格式化降級告警（pipeline 某 phase 失敗）
   */
  formatDegradedAlert(phase, details = {}) {
    const lines = [
      `🔴 Pipeline 降級告警`,
      `Phase: ${phase}`,
      `時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`,
      ''
    ];
    if (details.error)    lines.push(`錯誤: ${details.error}`);
    if (details.degraded) lines.push(`降級欄位: ${details.degraded.join(', ')}`);
    if (details.message)  lines.push(details.message);
    return lines.join('\n');
  }

  /**
   * 格式化成本日報（用於 /cost 指令回覆）
   */
  formatCostReport(costSummary) {
    const { totalCost = 0, budget = 2, apiCalls = {}, llmUsage = {} } = costSummary;
    const pct    = ((totalCost / budget) * 100).toFixed(1);
    const bar    = this._progressBar(totalCost / budget, 10);

    const lines = [
      `💰 今日成本報告`,
      `${bar} $${totalCost.toFixed(4)} / $${budget} (${pct}%)`,
      ''
    ];

    if (Object.keys(apiCalls).length > 0) {
      lines.push('API 呼叫:');
      for (const [api, count] of Object.entries(apiCalls)) {
        if (count > 0) lines.push(`  ${api}: ${count} 次`);
      }
    }

    if (llmUsage.haiku || llmUsage.sonnet) {
      lines.push('LLM 用量:');
      if (llmUsage.haiku)  lines.push(`  Haiku:  in=${llmUsage.haiku.inputTokens} out=${llmUsage.haiku.outputTokens}`);
      if (llmUsage.sonnet) lines.push(`  Sonnet: in=${llmUsage.sonnet.inputTokens} out=${llmUsage.sonnet.outputTokens}`);
    }

    return lines.join('\n');
  }

  // ── 私有輔助方法 ──────────────────────────────────────────────────────────

  /**
   * 按段落邊界切割（優先在空白行處切）
   */
  _splitByParagraph(text, maxLen) {
    const parts = [];
    let remaining = text;

    while (remaining.length > maxLen) {
      // 找最後一個可切割的位置（空白行 → 換行 → 字元）
      let cutAt = this._findCutPoint(remaining, maxLen);
      parts.push(remaining.slice(0, cutAt).trimEnd());
      remaining = remaining.slice(cutAt).trimStart();
    }

    if (remaining.length > 0) {
      parts.push(remaining);
    }

    return parts;
  }

  _findCutPoint(text, maxLen) {
    const chunk = text.slice(0, maxLen);

    // 1. 優先在空白行（\n\n）切割
    const doubleNewline = chunk.lastIndexOf('\n\n');
    if (doubleNewline > maxLen * 0.5) return doubleNewline + 2;

    // 2. 其次在換行符
    const newline = chunk.lastIndexOf('\n');
    if (newline > maxLen * 0.5) return newline + 1;

    // 3. 最後直接在 maxLen 截斷
    return maxLen;
  }

  _progressBar(ratio, width = 10) {
    const filled = Math.round(Math.min(ratio, 1) * width);
    const empty  = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}

module.exports = new TelegramFormatter();
module.exports.TelegramFormatter = TelegramFormatter;
