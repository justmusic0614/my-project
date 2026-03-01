/**
 * alerter.js — 故障告警（M11）
 *
 * 告警條件（rules.json alerts 設定）：
 *   IMAP_LABEL_NOT_FOUND  — IMAP label 不存在 → 阻擋執行
 *   IMAP_ZERO_EMAILS      — IMAP 收到 0 封 → 告警，繼續執行
 *   PARSE_OK_RATE_LOW     — email_parse_ok_rate < 0.9 → 告警
 *   HIGH_CONF_RATE_DROP   — high_conf_rate 較前次下降 > 0.2 → 警告
 *   NEW_TEMPLATE_FP_HIGH  — 新 template_fp 比例 > 0.5 → 警告
 *   SMTP_FAILED           — 發信失敗 → 告警（呼叫端重試後才呼叫此函式）
 *
 * 告警等級：
 *   ERROR — 需立即處理（阻擋執行或 digest 無法送出）
 *   WARN  — 監控即可（系統仍正常，但有異常訊號）
 *
 * 告警輸出：寫入 stderr（log）+ 累積到 run.errors 陣列
 */

'use strict';

// ── Alert 物件格式 ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} Alert
 * @property {string}  code      — 告警代碼
 * @property {'ERROR'|'WARN'} level
 * @property {string}  message   — 人類可讀描述
 * @property {Object}  [context] — 附加資訊
 */

// ── 主要 API ─────────────────────────────────────────────────────────────────

/**
 * 執行前檢查（IMAP label 驗證）
 * 若回傳 ERROR 等級告警，呼叫端應停止執行。
 *
 * @param {string[]} availableMailboxes — IMAP 可用的 mailbox 清單
 * @param {string}   expectedLabel      — config.imap.label
 * @returns {Alert[]}
 */
function checkStartup(availableMailboxes, expectedLabel) {
  const alerts = [];
  if (!availableMailboxes.includes(expectedLabel)) {
    alerts.push({
      code: 'IMAP_LABEL_NOT_FOUND',
      level: 'ERROR',
      message: `IMAP label "${expectedLabel}" 不存在。請先在 Gmail 建立 Filter 並套用 label。`,
      context: {
        expected: expectedLabel,
        available: availableMailboxes.slice(0, 10),  // 只顯示前 10 個
      },
    });
  }
  return alerts;
}

/**
 * 收信後檢查
 *
 * @param {number}   emailCount — 本次收到的 email 數量
 * @returns {Alert[]}
 */
function checkCollect(emailCount) {
  const alerts = [];
  if (emailCount === 0) {
    alerts.push({
      code: 'IMAP_ZERO_EMAILS',
      level: 'WARN',
      message: `IMAP 本次收到 0 封通知信。可能是 Gmail filter 未設定、FB 通知關閉、或今日真的無新貼文。`,
      context: { email_count: 0 },
    });
  }
  return alerts;
}

/**
 * 解析後品質檢查
 *
 * @param {Object}  parseStats   — { email_parse_ok_rate, post_extract_ok_rate, high_conf_rate, template_fp_stats }
 * @param {Object}  prevStats    — 前次 run 的相同統計（用於趨勢比較）
 * @param {Object}  alertConfig  — rules.json 的 alerts 區塊
 * @returns {Alert[]}
 */
function checkParseQuality(parseStats, prevStats, alertConfig) {
  const alerts = [];
  const cfg = alertConfig || {};

  const parseOkMin = cfg.email_parse_ok_rate_min ?? 0.9;
  const highConfDrop = cfg.high_conf_rate_drop_threshold ?? 0.2;
  const newFpRateThreshold = cfg.new_template_fp_rate_threshold ?? 0.5;

  // email_parse_ok_rate 低於閾值
  if (parseStats.email_parse_ok_rate != null && parseStats.email_parse_ok_rate < parseOkMin) {
    alerts.push({
      code: 'PARSE_OK_RATE_LOW',
      level: 'ERROR',
      message: `email_parse_ok_rate ${_pct(parseStats.email_parse_ok_rate)} 低於閾值 ${_pct(parseOkMin)}。FB 可能改了通知信格式。`,
      context: {
        current: parseStats.email_parse_ok_rate,
        threshold: parseOkMin,
      },
    });
  }

  // high_conf_rate 較前次下降超過閾值
  if (
    parseStats.high_conf_rate != null &&
    prevStats?.high_conf_rate != null &&
    (prevStats.high_conf_rate - parseStats.high_conf_rate) > highConfDrop
  ) {
    alerts.push({
      code: 'HIGH_CONF_RATE_DROP',
      level: 'WARN',
      message: `high_conf_rate 從 ${_pct(prevStats.high_conf_rate)} 下降至 ${_pct(parseStats.high_conf_rate)}（下降 ${_pct(prevStats.high_conf_rate - parseStats.high_conf_rate)}）。FB 可能改了 email 模板，但仍可用。`,
      context: {
        current: parseStats.high_conf_rate,
        prev: prevStats.high_conf_rate,
        drop: prevStats.high_conf_rate - parseStats.high_conf_rate,
      },
    });
  }

  // 新 template_fp 比例高（模板變化劇烈）
  if (parseStats.template_fp_stats) {
    const fpAlert = _checkTemplateFp(parseStats.template_fp_stats, newFpRateThreshold);
    if (fpAlert) alerts.push(fpAlert);
  }

  return alerts;
}

/**
 * 發信失敗告警
 *
 * @param {string} errorMessage — nodemailer 錯誤訊息
 * @param {boolean} [isRetry=false] — 是否已重試過一次
 * @returns {Alert}
 */
function checkSmtpFailed(errorMessage, isRetry = false) {
  return {
    code: 'SMTP_FAILED',
    level: 'ERROR',
    message: `SMTP 發信失敗${isRetry ? '（已重試一次）' : ''}：${errorMessage}`,
    context: { error: errorMessage, is_retry: isRetry },
  };
}

/**
 * 將 alerts 列印到 stderr
 *
 * @param {Alert[]} alerts
 * @param {Function} [logFn] — 自訂 log 函式（預設寫到 stderr）
 */
function printAlerts(alerts, logFn) {
  const fn = logFn || ((level, msg) => {
    const icon = level === 'ERROR' ? '❌' : '⚠️ ';
    process.stderr.write(`${icon} [ALERT] ${msg}\n`);
  });

  for (const alert of alerts) {
    fn(alert.level, `[${alert.code}] ${alert.message}`);
  }
}

/**
 * 判斷 alerts 中是否有 ERROR 等級（呼叫端決定是否停止執行）
 *
 * @param {Alert[]} alerts
 * @returns {boolean}
 */
function hasError(alerts) {
  return alerts.some(a => a.level === 'ERROR');
}

// ── 內部工具函式 ─────────────────────────────────────────────────────────────

function _checkTemplateFp(fpStats, threshold) {
  const entries = Object.entries(fpStats);
  if (entries.length === 0) return null;

  const total = entries.reduce((s, [, c]) => s + c, 0);
  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const topFp = sorted[0][0];
  const topCount = sorted[0][1];
  const newFpRate = 1 - (topCount / total);

  if (newFpRate > threshold) {
    return {
      code: 'NEW_TEMPLATE_FP_HIGH',
      level: 'WARN',
      message: `新 template_fp 比例 ${_pct(newFpRate)} 高於閾值 ${_pct(threshold)}。FB 可能更新了通知信模板，建議觀察 parse_ok_rate。`,
      context: {
        dominant_fp: topFp,
        dominant_count: topCount,
        total,
        new_fp_rate: newFpRate,
        all_fps: Object.fromEntries(sorted.slice(0, 5)),
      },
    };
  }
  return null;
}

function _pct(v) {
  if (v == null) return 'n/a';
  return `${Math.round(v * 100)}%`;
}

// ── 模組匯出 ─────────────────────────────────────────────────────────────────

module.exports = {
  checkStartup,
  checkCollect,
  checkParseQuality,
  checkSmtpFailed,
  printAlerts,
  hasError,
  // 內部函式供測試使用
  _checkTemplateFp,
};
