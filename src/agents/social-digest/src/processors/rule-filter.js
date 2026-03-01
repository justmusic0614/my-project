/**
 * rule-filter.js — 規則優先 guardrail（M8）
 *
 * 在 Post Scorer 之前執行，AI 不得違反這裡的硬規則。
 *
 * 規則優先順序：
 *   1. must_include 群組（sources.json must_include: true）
 *      → importance 保底 60，保證進 digest
 *   2. must_keywords（rules.json must_keywords）
 *      → 命中即保底 60
 *   3. mute_keywords（rules.json mute_keywords）
 *      → 命中降 -30，限制在 Everything Else 最底層
 *
 * must_include 配額控制（防 Top Picks 被塞爆）：
 *   must_include_quota = min(8, top_picks_max / 2)
 *   超過 quota 的仍保底進 digest，但落在 Everything Else
 *   （section = 'must_overflow'，final_rank <= top_picks_max + 20）
 *
 * 輸出：每個 post 增加下列欄位：
 *   - rule_boost       {number}  — 規則加分（must → +60, mute → -30）
 *   - must_include     {boolean} — 是否為必看群組
 *   - must_keyword_hit {string|null} — 命中的 must_keyword
 *   - mute_keyword_hit {string|null} — 命中的 mute_keyword
 *   - rule_section     {string|null} — 'must_include' | 'must_overflow' | null
 */

'use strict';

// ── 主要 API ─────────────────────────────────────────────────────────────────

/**
 * 對 posts[] 套用規則過濾，回傳帶有 rule_boost 等欄位的新陣列。
 *
 * @param {Array}  posts      — 貼文陣列（來自 deduplicator / DB）
 * @param {Object} rules      — rules.json 的解析結果
 * @param {Object} sourceMap  — { groupUrl → source 物件 }（由 SourceManager 建立）
 * @returns {Array} 帶有 rule metadata 的貼文陣列
 */
function applyRules(posts, rules, sourceMap) {
  const mustKeywords = (rules.must_keywords || []).map(k => k.toLowerCase());
  const muteKeywords = (rules.mute_keywords || []).map(k => k.toLowerCase());
  const topPicksMax = rules.top_picks_max || 20;
  const mustIncludeQuota = rules.must_include_quota || Math.min(8, Math.floor(topPicksMax / 2));

  // 第一遍：標記每個 post 的規則命中
  const tagged = posts.map(post => {
    const result = _tagPost(post, mustKeywords, muteKeywords, sourceMap);
    return { ...post, ...result };
  });

  // 第二遍：配額控制（must_include 超過 quota 的 → must_overflow）
  let mustCount = 0;
  for (const post of tagged) {
    if (post.rule_section === 'must_include') {
      mustCount++;
      if (mustCount > mustIncludeQuota) {
        post.rule_section = 'must_overflow';
        // must_overflow 仍保底 60，但後續排序會把它放在 top_picks 區後
      }
    }
  }

  return tagged;
}

/**
 * 計算規則最終保底分（結合 rule_boost + 來自 sources 的 must_include）
 *
 * @param {Object} post — applyRules 輸出的 post（含 rule_boost）
 * @returns {number}    — rule 保底分（0 表示沒有保底）
 */
function getRuleFloor(post) {
  if (post.must_include || post.must_keyword_hit) {
    return 60;
  }
  return 0;
}

// ── 內部函式 ─────────────────────────────────────────────────────────────────

/**
 * 標記單一 post 的規則命中結果
 */
function _tagPost(post, mustKeywords, muteKeywords, sourceMap) {
  let ruleBoost = 0;
  let mustInclude = false;
  let mustKeywordHit = null;
  let muteKeywordHit = null;
  let ruleSection = null;

  // 1. must_include 群組
  const src = sourceMap ? sourceMap[_normalizeUrl(post.group_url)] : null;
  if (src && src.must_include === true) {
    mustInclude = true;
    ruleBoost = Math.max(ruleBoost, 60);
    ruleSection = 'must_include';
  }

  // 2. must_keywords 命中（標題 / snippet / group_name）
  const searchText = _buildSearchText(post);
  if (!mustInclude) {
    for (const kw of mustKeywords) {
      if (searchText.includes(kw)) {
        mustKeywordHit = kw;
        ruleBoost = Math.max(ruleBoost, 60);
        ruleSection = 'must_include';
        break;
      }
    }
  }

  // 3. mute_keywords 命中
  for (const kw of muteKeywords) {
    if (searchText.includes(kw)) {
      muteKeywordHit = kw;
      ruleBoost = Math.min(ruleBoost, -30);
      break;
    }
  }

  return {
    rule_boost: ruleBoost,
    must_include: mustInclude,
    must_keyword_hit: mustKeywordHit,
    mute_keyword_hit: muteKeywordHit,
    rule_section: ruleSection,
  };
}

/**
 * 建立用於關鍵字搜尋的文字（snippet + group_name + author）
 */
function _buildSearchText(post) {
  return [
    post.snippet || '',
    post.group_name || '',
    post.author || '',
  ].join(' ').toLowerCase();
}

/**
 * 正規化 URL（去尾端斜線 + 小寫，用於 sourceMap 查找）
 */
function _normalizeUrl(url) {
  if (!url) return '';
  return url.replace(/\/$/, '').toLowerCase();
}

/**
 * 從 SourceManager 的 sources 陣列建立 { normalizedUrl → source } 的 Map
 * 方便 applyRules 快速查找
 *
 * @param {Array} sources — SourceManager.getEnabled() 的結果
 * @returns {Object}
 */
function buildSourceMap(sources) {
  const map = {};
  for (const s of sources) {
    if (s.url) {
      map[_normalizeUrl(s.url)] = s;
    }
  }
  return map;
}

// ── 模組匯出 ─────────────────────────────────────────────────────────────────

module.exports = {
  applyRules,
  getRuleFloor,
  buildSourceMap,
  // 內部函式供測試使用
  _tagPost,
  _buildSearchText,
  _normalizeUrl,
};
