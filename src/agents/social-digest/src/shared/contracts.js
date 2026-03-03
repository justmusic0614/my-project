'use strict';

// ─── Social-Digest 最小資料契約 ───────────────────────────────
// 跨模組共用的資料格式常量，避免欄位漂移。
// 所有模組 import 此檔案取常量，不各自硬編碼。

/** run_id 時區（D1） */
const RUN_ID_TIMEZONE = 'Asia/Taipei';

/** run_id 格式 */
const RUN_ID_FORMAT = 'YYYYMMDD';

/**
 * 產生 run_id — 唯一生成點（D1）
 * agent.js run() 開頭呼叫一次，之後一路傳遞。
 * @param {Date} [date] - 預設 now
 * @returns {string} e.g. '20260304'
 */
function makeRunId(date) {
  const d = date || new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: RUN_ID_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA → 'YYYY-MM-DD'
  return formatter.format(d).replace(/-/g, '');
}

// ─── AI Results ──────────────────────────────────────────────

/** ai_results row 必要欄位 */
const AI_RESULT_FIELDS = [
  'post_id', 'category', 'summary', 'tags',
  'importance_score', 'ai_confidence', 'reasons',
];

/** ai_confidence 合法值 */
const AI_CONFIDENCE_ENUM = ['HIGH', 'MED', 'LOW'];

// ─── Feedback ────────────────────────────────────────────────

/** feedback action 合法值 */
const FEEDBACK_ACTIONS = ['click', 'good', 'pin', 'mute'];

/** feedback action 權重（用於 NDCG / NS 計算） */
const FEEDBACK_WEIGHTS = { pin: 3, good: 2, click: 1, mute: 0 };

/**
 * rel 聚合規則（E5）
 * 同一 post 多筆 feedback → 取最大值，不累加。
 * NDCG / NS 統一引用此常量。
 */
const REL_AGGREGATION = 'max';

// ─── Snapshot ────────────────────────────────────────────────

/** snapshot 必要 key（B4 / C4） */
const SNAPSHOT_KEYS = [
  'shortcode_map',    // shortcode → post_id
  'index_map',        // 序號 → post_id
  'shortcode_url_map', // shortcode → url（C4: redirect 不查 DB）
  'run_id',
  'created_at',
];

// ─── 長度限制（B5） ──────────────────────────────────────────

const SUMMARY_MAX_CHARS = 300;
const REASONS_MAX_COUNT = 3;
const TAGS_MAX_COUNT = 5;

// ─── Shortcode 規則（D2） ────────────────────────────────────
// shortcode 允許跨 run 重複；所有解析以 (rid, shortcode) 為主鍵。
// 不可將 shortcode 當全局唯一 ID。

module.exports = {
  RUN_ID_TIMEZONE,
  RUN_ID_FORMAT,
  makeRunId,

  AI_RESULT_FIELDS,
  AI_CONFIDENCE_ENUM,

  FEEDBACK_ACTIONS,
  FEEDBACK_WEIGHTS,
  REL_AGGREGATION,

  SNAPSHOT_KEYS,

  SUMMARY_MAX_CHARS,
  REASONS_MAX_COUNT,
  TAGS_MAX_COUNT,
};
