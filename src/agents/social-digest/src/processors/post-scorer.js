/**
 * post-scorer.js — 貼文評分 + novelty 降權（M10）
 *
 * Phase 1（無 AI 分數）評分維度：
 *   base_score = 50
 *   + keyword_bonus  — must_keywords 命中 +20，普通文字匹配 0
 *   + rule_boost     — rule-filter 的 rule_boost（must +60, mute -30）
 *   × group_weight   — sources.json 的 weight（[0.2, 3.0]）
 *   - novelty_penalty — topic_signature 或 source_signature 的降權
 *   → clamped [0, 100]
 *
 * Phase 2 接入 AI 後：
 *   calcCalibratedScore(rawAiScores) → calibrated_score（已留介面）
 *   scorer 改用 calibrated_score 取代 base_score + keyword_bonus
 *
 * novelty 降權（兩層 signature）：
 *   topic_signature  — tags_json hash，24h 視窗，重複降 topic_penalty 分
 *   source_signature — group_url + author，7d 視窗，重複降 source_penalty 分
 *   novelty 豁免：must_keywords 命中時 topic_penalty 減半
 *   novelty_exempt_keywords：完全不降權
 *
 * 輸出欄位（每個 post 新增）：
 *   keyword_bonus     {number}
 *   novelty_penalty   {number}   — 負數或 0
 *   score             {number}   — Phase 1 最終分數（0~100）
 *   calibrated_score  {number|null} — Phase 2 AI 校正後分數
 */

'use strict';

// ── Phase 2：可信域名白名單 ──────────────────────────────────────────────────

const REPUTABLE_DOMAINS = new Set([
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'research.google',
  'blog.google',
  'arxiv.org',
  'huggingface.co',
  'github.com',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'nature.com',
]);

// ── AI 分數校正（Phase 2 介面，Phase 1 不呼叫） ─────────────────────────────

/**
 * AI 分數校正（Score Calibration）
 * 取 P50/P80 線性拉伸，使分布固定在穩定錨點。
 *
 * @param {number[]} rawScores — AI 輸出的 importance_score 陣列
 * @returns {{ p50: number, p80: number, calibrate: (s: number) => number }}
 *   - calibrate(s)：回傳校正後的分數（若無法校正回傳 null）
 */
function calcCalibratedScore(rawScores) {
  if (!rawScores || rawScores.length < 10) {
    // 樣本太少，無法校正
    return { p50: null, p80: null, calibrate: () => null };
  }

  const sorted = [...rawScores].sort((a, b) => a - b);
  const p50 = _percentile(sorted, 50);
  const p80 = _percentile(sorted, 80);

  if (p80 === p50) {
    // 分數全一樣，無法除以 0 → 跳過校正，加輕微 jitter
    return {
      p50,
      p80,
      calibrate: (s) => Math.min(100, Math.max(0, s + (Math.random() - 0.5) * 2)),
    };
  }

  return {
    p50,
    p80,
    calibrate: (s) => {
      const calibrated = ((s - p50) / (p80 - p50)) * 30 + 50;
      return Math.min(100, Math.max(0, Math.round(calibrated)));
    },
  };
}

// ── 主要 API ─────────────────────────────────────────────────────────────────

/**
 * 對 posts[] 計算評分，回傳帶有 score 欄位的新陣列（由高到低排序）。
 *
 * @param {Array}  posts           — rule-filter 輸出的 posts（含 rule_boost）
 * @param {Object} rules           — rules.json
 * @param {Object} sourceMap       — { normalizedUrl → source }（同 rule-filter 格式）
 * @param {Object} topicSigCounts  — db.getRecentTopicSignatures() 的結果（tagsJson → count）
 * @param {Object} sourceSigCounts — db.getRecentSourceSignatures() 的結果（key → count）
 * @returns {Array} 帶有 score 的貼文陣列（由高到低排序）
 */
function scorePosts(posts, rules, sourceMap, topicSigCounts = {}, sourceSigCounts = {}) {
  const noveltyRules = rules.novelty || {};
  const topicPenalty = noveltyRules.topic_signature_penalty ?? 15;
  const sourcePenalty = noveltyRules.source_signature_penalty ?? 5;
  const noNoveltyGroups = new Set((rules.no_novelty_penalty_groups || []).map(u => u.toLowerCase()));
  const noveltyExemptKws = (rules.novelty_exempt_keywords || []).map(k => k.toLowerCase());
  const mustKeywords = (rules.must_keywords || []).map(k => k.toLowerCase());

  const scored = posts.map(post => {
    const weight = _getWeight(post, sourceMap);
    const keywordBonus = _calcKeywordBonus(post, mustKeywords);
    const noveltyPenalty = _calcNoveltyPenalty(
      post, topicSigCounts, sourceSigCounts,
      topicPenalty, sourcePenalty, noNoveltyGroups, noveltyExemptKws
    );

    // Phase 2 分數：(base + keyword_bonus + rule_boost) × weight + novelty_penalty + 6 個新訊號
    const ruleBoost = post.rule_boost ?? 0;
    const raw = (50 + keywordBonus + ruleBoost) * weight
      + noveltyPenalty
      + _calcSourceTypeBoost(post)
      + _calcDomainRepBoost(post)
      + _calcKeywordPackBonus(post, rules)
      + _calcRecencyCurve(post)
      + _calcLanguageHint(post, sourceMap)
      + _calcSourceTrustPenalty(post, sourceMap);
    const score = Math.min(100, Math.max(0, Math.round(raw)));

    return {
      ...post,
      group_weight: weight,
      keyword_bonus: keywordBonus,
      novelty_penalty: noveltyPenalty,
      score,
      calibrated_score: null,  // Phase 2 接入 AI 後填入
    };
  });

  // deterministic 排序：score desc → first_seen_at desc → id asc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.first_seen_at && b.first_seen_at) {
      if (b.first_seen_at > a.first_seen_at) return 1;
      if (b.first_seen_at < a.first_seen_at) return -1;
    }
    return (a.id || '').localeCompare(b.id || '');
  });

  return scored;
}

/**
 * 根據 score + rule_section 分配 section（top_picks / everything_else / overflow）
 * 同時計算 final_rank（整體排名，1-indexed）
 *
 * @param {Array}  scoredPosts  — scorePosts() 輸出（已排序）
 * @param {Object} rules        — rules.json
 * @returns {Array} 帶有 final_rank + section 欄位的貼文陣列
 */
function assignSections(scoredPosts, rules) {
  const topPicksMax = rules.top_picks_max || 20;
  const everythingElseMax = rules.everything_else_max || 60;

  let topPicksCount = 0;
  let everythingElseCount = 0;

  return scoredPosts.map((post, idx) => {
    const finalRank = idx + 1;
    let section;

    if (post.rule_section === 'must_include' && topPicksCount < topPicksMax) {
      // must_include 強制進 Top Picks（在 quota 內）
      section = 'top_picks';
      topPicksCount++;
    } else if (post.rule_section === 'must_overflow') {
      // must_overflow：超過 quota，保底在 Everything Else 前段
      // 確保 final_rank <= top_picks_max + 20
      section = 'everything_else';
      everythingElseCount++;
    } else if (topPicksCount < topPicksMax) {
      section = 'top_picks';
      topPicksCount++;
    } else if (everythingElseCount < everythingElseMax) {
      section = 'everything_else';
      everythingElseCount++;
    } else {
      section = 'overflow';
    }

    return { ...post, final_rank: finalRank, section };
  });
}

// ── 內部計算函式 ─────────────────────────────────────────────────────────────

function _getWeight(post, sourceMap) {
  if (!sourceMap || !post.group_url) return 1.0;
  const key = post.group_url.replace(/\/$/, '').toLowerCase();
  const src = sourceMap[key];
  return src ? (src.weight ?? 1.0) : 1.0;
}

function _calcKeywordBonus(post, mustKeywords) {
  if (!mustKeywords.length) return 0;
  const text = [post.snippet || '', post.group_name || ''].join(' ').toLowerCase();
  for (const kw of mustKeywords) {
    if (text.includes(kw)) return 20;
  }
  return 0;
}

function _calcNoveltyPenalty(
  post, topicSigCounts, sourceSigCounts,
  topicPenalty, sourcePenalty, noNoveltyGroups, noveltyExemptKws
) {
  // no_novelty_penalty_groups：完全不降權
  const groupKey = (post.group_url || '').replace(/\/$/, '').toLowerCase();
  if (noNoveltyGroups.has(groupKey)) return 0;

  // novelty_exempt_keywords：命中時不降權
  const text = [post.snippet || '', post.group_name || ''].join(' ').toLowerCase();
  for (const kw of noveltyExemptKws) {
    if (text.includes(kw)) return 0;
  }

  let penalty = 0;

  // topic_signature（tags_json hash，24h 視窗）
  if (post.tags_json && topicSigCounts[post.tags_json]) {
    const count = topicSigCounts[post.tags_json];
    if (count > 1) {
      // must_keywords 命中時降權減半
      const isMustKw = post.must_keyword_hit != null;
      penalty -= isMustKw ? Math.floor(topicPenalty / 2) : topicPenalty;
    }
  }

  // source_signature（group_url + author，7d 視窗）
  if (post.group_url && post.author) {
    const sigKey = `${post.group_url}::${post.author}`;
    const count = sourceSigCounts[sigKey] || 0;
    if (count > 1) {
      penalty -= sourcePenalty;
    }
  }

  return penalty;
}

function _percentile(sortedArr, p) {
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo];
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// ── Phase 2 新訊號 ───────────────────────────────────────────────────────────

/**
 * 訊號 1：source_type_boost
 * hackernews +5, github_releases +8, rss +3, others 0
 */
function _calcSourceTypeBoost(post) {
  switch (post.source) {
    case 'hackernews': return 5;
    case 'github_releases': return 8;
    case 'rss': return 3;
    default: return 0;
  }
}

/**
 * 訊號 2：domain_reputation_boost
 * URL host 在 REPUTABLE_DOMAINS 白名單 +5
 */
function _calcDomainRepBoost(post) {
  if (!post.url) return 0;
  try {
    const { URL: NodeURL } = require('url');
    const host = new NodeURL(post.url).hostname.replace(/^www\./, '');
    return REPUTABLE_DOMAINS.has(host) ? 5 : 0;
  } catch {
    return 0;
  }
}

/**
 * 訊號 3：keyword_pack_bonus
 * rules.keyword_packs 命中 → 各 pack 的 bonus 加總
 */
function _calcKeywordPackBonus(post, rules) {
  const packs = rules.keyword_packs;
  if (!packs || typeof packs !== 'object') return 0;
  const text = [post.title || '', post.snippet || ''].join(' ');
  let total = 0;
  for (const pack of Object.values(packs)) {
    if (!pack.keywords || !pack.bonus) continue;
    for (const kw of pack.keywords) {
      if (text.includes(kw)) {
        total += pack.bonus;
        break; // 每個 pack 只加一次
      }
    }
  }
  return total;
}

/**
 * 訊號 4：recency_curve
 * 24h 內 +5, 48h 內 +3, 72h 內 0, 更舊 -5
 */
function _calcRecencyCurve(post) {
  if (!post.published_at) return 0;
  const pubDate = new Date(post.published_at);
  if (isNaN(pubDate.getTime())) return 0;
  const hoursAgo = (Date.now() - pubDate.getTime()) / 3600000;
  if (hoursAgo <= 24) return 5;
  if (hoursAgo <= 48) return 3;
  if (hoursAgo <= 72) return 0;
  return -5;
}

/**
 * 訊號 5：language_hint
 * 比對文章語言與 source 設定語言
 * 一致 +2, 不一致 -3, 無 source 語言設定 0
 *
 * CJK 字元比例 > 15% → 判定為 zh
 */
function _calcLanguageHint(post, sourceMap) {
  // 找 source 語言設定（sourceMap 是 url → source，web 來源沒有 group_url）
  // 改用 post.source + group_name 反查 sourceMap 中的 language
  // sourceMap 格式是 { normalizedUrl → source }，web post 的 group_url 為 null
  // 直接從 post 的 raw template_fp 解析較複雜，改用輕量方式：
  // 若 sourceMap 任一 value 的 id 能對應 raw.source_id，取其 language
  if (!sourceMap) return 0;

  let sourceLang = null;
  // 嘗試從 template_fp 解析 source_id
  let sourceId = null;
  if (post.template_fp) {
    try {
      const raw = JSON.parse(post.template_fp);
      sourceId = raw.source_id || null;
    } catch {
      // ignore
    }
  }

  if (sourceId) {
    for (const src of Object.values(sourceMap)) {
      if (src.id === sourceId && src.language) {
        sourceLang = src.language;
        break;
      }
    }
  }

  if (!sourceLang) return 0;

  // 偵測文章語言（CJK 比例）
  const text = [post.title || '', post.snippet || ''].join(' ');
  const cjkCount = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  const ratio = text.length > 0 ? cjkCount / text.length : 0;
  const detectedLang = ratio > 0.15 ? 'zh' : 'en';

  return detectedLang === sourceLang ? 2 : -3;
}

/**
 * 訊號 6：source_trust_penalty
 * sourceConfig.trust === 'low' → -5
 * 透過 template_fp 反查 source_id → sourceMap
 */
function _calcSourceTrustPenalty(post, sourceMap) {
  if (!sourceMap || !post.template_fp) return 0;

  let sourceId = null;
  try {
    const raw = JSON.parse(post.template_fp);
    sourceId = raw.source_id || null;
  } catch {
    return 0;
  }

  if (!sourceId) return 0;

  for (const src of Object.values(sourceMap)) {
    if (src.id === sourceId && src.trust === 'low') {
      return -5;
    }
  }
  return 0;
}

// ── 模組匯出 ─────────────────────────────────────────────────────────────────

module.exports = {
  scorePosts,
  assignSections,
  calcCalibratedScore,
  // 內部函式供測試使用
  _calcKeywordBonus,
  _calcNoveltyPenalty,
  _percentile,
  _calcSourceTypeBoost,
  _calcDomainRepBoost,
  _calcKeywordPackBonus,
  _calcRecencyCurve,
  _calcLanguageHint,
  _calcSourceTrustPenalty,
};
