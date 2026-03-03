'use strict';

/**
 * kpi-calculator.js — 4 層 KPI 計算（M16）
 *
 * Layer 1: CTR（click-through rate）
 * Layer 2: NDCG@K（主指標）
 * Layer 3: must_include 漏報防護
 * Layer 4: North Star = Σ max_rel / top_picks_count
 *
 * rel 取最大值（A7）— 同一 post 多 feedback 不累加。
 * 統一引用 contracts.FEEDBACK_WEIGHTS + REL_AGGREGATION。
 */

const {
  FEEDBACK_WEIGHTS,
  FEEDBACK_ACTIONS,
} = require('./contracts');

// ── buildFeedbackMap ──────────────────────────────────────────────────────────

/**
 * feedback 表 → { post_id: max_rel }
 * A7: 同一 post 多筆 feedback → 取最高權重
 *
 * @param {Array} feedbacks - [{ post_id, action }]
 * @returns {Object} { post_id: max_rel_weight }
 */
function buildFeedbackMap(feedbacks) {
  const map = {};
  for (const fb of feedbacks) {
    if (!fb.post_id || !fb.action) continue;
    const weight = FEEDBACK_WEIGHTS[fb.action] ?? 0;
    map[fb.post_id] = Math.max(map[fb.post_id] || 0, weight);
  }
  return map;
}

// ── Layer 1: CTR ──────────────────────────────────────────────────────────────

/**
 * CTR_top = unique clicked posts in top_picks / top_picks_count
 * CTR_all = unique clicked posts / total sent posts
 *
 * C8: 用去重後 unique click 計算
 * D5: CTR_top 分母 = email 實際輸出的 top_picks_count
 *
 * @param {Array} feedbacks - feedback rows for this run
 * @param {number} topPicksCount - 實際 email 輸出的 top picks 數量
 * @param {number} totalSent - 實際 email 輸出的總貼文數
 * @param {Array} topPicksIds - top picks 的 post_ids
 * @returns {{ ctr_top: number, ctr_all: number }}
 */
function calcCTR(feedbacks, topPicksCount, totalSent, topPicksIds) {
  const topPicksSet = new Set(topPicksIds || []);

  // unique click post_ids
  const clickedPosts = new Set();
  const clickedTopPosts = new Set();

  for (const fb of feedbacks) {
    if (fb.action !== 'click' || !fb.post_id) continue;
    clickedPosts.add(fb.post_id);
    if (topPicksSet.has(fb.post_id)) {
      clickedTopPosts.add(fb.post_id);
    }
  }

  return {
    ctr_top: topPicksCount > 0 ? clickedTopPosts.size / topPicksCount : 0,
    ctr_all: totalSent > 0 ? clickedPosts.size / totalSent : 0,
  };
}

// ── Layer 2: NDCG@K ──────────────────────────────────────────────────────────

/**
 * NDCG@K（Normalized Discounted Cumulative Gain）
 *
 * DCG@K = Σ (rel_i / log2(i + 1))  for i = 1..K
 * IDCG@K = 理想排序的 DCG
 *
 * @param {Array} rankedPostIds - 依排名順序的 post_ids（index 0 = rank 1）
 * @param {Object} feedbackMap - { post_id: max_rel }
 * @param {number} K - 截斷位置（預設 20）
 * @returns {{ ndcg: number, dcg: number, idcg: number }}
 */
function calcNDCG(rankedPostIds, feedbackMap, K = 20) {
  const rels = rankedPostIds.slice(0, K).map(id => feedbackMap[id] || 0);

  // DCG
  let dcg = 0;
  for (let i = 0; i < rels.length; i++) {
    dcg += rels[i] / Math.log2(i + 2); // i+2 因為 rank 從 1 開始
  }

  // IDCG（理想排序：rels 由大到小）
  const idealRels = Object.values(feedbackMap)
    .filter(v => v > 0)
    .sort((a, b) => b - a)
    .slice(0, K);

  let idcg = 0;
  for (let i = 0; i < idealRels.length; i++) {
    idcg += idealRels[i] / Math.log2(i + 2);
  }

  return {
    ndcg: idcg > 0 ? dcg / idcg : 0,
    dcg,
    idcg,
  };
}

// ── Layer 4: North Star ──────────────────────────────────────────────────────

/**
 * NS = Σ max_rel(top_picks_posts) / top_picks_count
 * B7: NS 也用 max rel（與 NDCG 一致）
 *
 * @param {Array} topPicksIds - top picks 的 post_ids
 * @param {Object} feedbackMap - { post_id: max_rel }
 * @returns {number} NS 值
 */
function calcNorthStar(topPicksIds, feedbackMap) {
  if (!topPicksIds || topPicksIds.length === 0) return 0;

  let totalRel = 0;
  for (const id of topPicksIds) {
    totalRel += feedbackMap[id] || 0;
  }

  return totalRel / topPicksIds.length;
}

// ── Layer 3: must_include Rate ───────────────────────────────────────────────

/**
 * must_include 漏報率 = 有 feedback 的 must_include posts 中，未進 top picks 的比例
 *
 * @param {Array} mustIncludeIds - 被標記為 must_include 的 post_ids
 * @param {Array} topPicksIds - 實際進入 top picks 的 post_ids
 * @returns {{ rate: number, missed: number, total: number }}
 */
function calcMustIncludeRate(mustIncludeIds, topPicksIds) {
  const topSet = new Set(topPicksIds);
  const missed = mustIncludeIds.filter(id => !topSet.has(id));

  return {
    rate: mustIncludeIds.length > 0 ? 1 - missed.length / mustIncludeIds.length : 1,
    missed: missed.length,
    total: mustIncludeIds.length,
  };
}

// ── Baseline-0 Shadow Run ────────────────────────────────────────────────────

/**
 * Baseline-0 NS = 無 AI、rules-only 的 North Star
 * C9: 以 Step 2 dedup 後的 posts list 為固定輸入快照
 * D6: 同時固定 rules/weights snapshot
 *
 * @param {Array} noAiRankedTopIds - 無 AI 排序的 top picks ids
 * @param {Object} feedbackMap - { post_id: max_rel }
 * @returns {number} baseline-0 NS
 */
function calcBaseline0NS(noAiRankedTopIds, feedbackMap) {
  return calcNorthStar(noAiRankedTopIds, feedbackMap);
}

// ── Kill Switch ──────────────────────────────────────────────────────────────

/**
 * 檢查 Kill Switch 觸發條件
 *
 * @param {object} recentKpi - 近期 KPI 資料 { ns_values: number[], ndcg_values: number[], baseline_0_ns: number }
 * @param {object} thresholds - rules.kill_switch
 * @returns {{ triggered: boolean, reason: string|null }}
 */
function checkKillSwitch(recentKpi, thresholds) {
  if (!thresholds) return { triggered: false, reason: null };

  const nsDays = thresholds.ns_consecutive_days || 7;
  const ndcgMin = thresholds.ndcg_min || 0.4;
  const ndcgWeeks = thresholds.ndcg_consecutive_weeks || 2;

  // 條件 1: NS_AI < baseline_0_ns 連續 N 天
  if (recentKpi.ns_values && recentKpi.baseline_0_ns != null) {
    const recent = recentKpi.ns_values.slice(-nsDays);
    if (recent.length >= nsDays && recent.every(ns => ns < recentKpi.baseline_0_ns)) {
      return {
        triggered: true,
        reason: `NS below baseline-0 for ${nsDays} consecutive days`,
      };
    }
  }

  // 條件 2: NDCG < ndcg_min 連續 N 週
  if (recentKpi.ndcg_values) {
    const recent = recentKpi.ndcg_values.slice(-ndcgWeeks);
    if (recent.length >= ndcgWeeks && recent.every(v => v < ndcgMin)) {
      return {
        triggered: true,
        reason: `NDCG below ${ndcgMin} for ${ndcgWeeks} consecutive weeks`,
      };
    }
  }

  return { triggered: false, reason: null };
}

// ── Weekly Report ────────────────────────────────────────────────────────────

/**
 * 匯總一週 KPI
 *
 * @param {Array} dailySnapshots - 本週每日 KPI snapshot
 * @returns {object} weekly summary
 */
function calcWeeklyReport(dailySnapshots) {
  if (!dailySnapshots || dailySnapshots.length === 0) {
    return { avg_ns: 0, avg_ndcg: 0, avg_ctr_top: 0, days: 0 };
  }

  const ns = dailySnapshots.map(s => s.ns || 0);
  const ndcg = dailySnapshots.map(s => s.ndcg || 0);
  const ctr = dailySnapshots.map(s => s.ctr_top || 0);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    avg_ns: Math.round(avg(ns) * 1000) / 1000,
    avg_ndcg: Math.round(avg(ndcg) * 1000) / 1000,
    avg_ctr_top: Math.round(avg(ctr) * 1000) / 1000,
    days: dailySnapshots.length,
    ns_trend: ns,
    ndcg_trend: ndcg,
  };
}

module.exports = {
  buildFeedbackMap,
  calcCTR,
  calcNDCG,
  calcNorthStar,
  calcMustIncludeRate,
  calcBaseline0NS,
  checkKillSwitch,
  calcWeeklyReport,
};
