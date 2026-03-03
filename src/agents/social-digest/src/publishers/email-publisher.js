/**
 * email-publisher.js — 兩段式 Digest 發信器（M9）
 *
 * 兩段式版型：
 *   Top Picks（前 N 則，AI 或規則排序最高）：
 *     [⭐score] 群組名 — 作者 [#短碼]
 *     2-4 行摘要（AI 有則顯示，無則顯示 snippet）
 *     #tags（AI 有則顯示）
 *     🔗 原文連結
 *
 *   Everything Else（其餘，上限 60 則）：
 *     群組名 — 作者 — 片段首行 [#短碼] 🔗原文
 *
 *   Overflow footer（超過 60 則時顯示）：
 *     本日共 N 篇，已列出 X + 60 篇，剩餘 Y 篇未列出
 *
 * Stable Token 短碼：
 *   shortcode = base32(sha256(post_id)).slice(0,4).toUpperCase()
 *   純展示用（Phase 1），Phase 2 加上回覆解析。
 *
 * 依賴：@sendgrid/mail（npm install @sendgrid/mail）
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// @sendgrid/mail 由 sendDigest() 動態 require（避免無 SENDGRID_API_KEY 時 crash）

// ── Stable Token 短碼 ─────────────────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * 計算貼文的 Stable Token 短碼
 * base32(sha256(post_id)).slice(0, 4)
 *
 * @param {string} postId — posts.id（sha256 canonical_url）
 * @returns {string} 4 位大寫英數字碼
 */
function calcShortcode(postId) {
  const hash = crypto.createHash('sha256').update(postId, 'utf8').digest();
  // 取前 5 bytes，base32 編碼後得到 8 字元，取前 4 字元
  let result = '';
  for (let i = 0; i < 5; i++) {
    const byte = hash[i];
    result += BASE32_CHARS[(byte >> 3) & 0x1f];
  }
  return result.slice(0, 4);
}

// ── 決策快照（M9.5） ─────────────────────────────────────────────────────────

/**
 * 產出 run snapshot JSON
 * 記錄完整分數拆解 + shortcode→post_id 映射
 *
 * @param {string} runId
 * @param {Array}  rankedPosts — assignSections() 輸出的 posts（含 final_rank, section）
 * @param {Object} quotaBreakdown — { must_include, ai, rule }
 * @returns {Object} snapshot 物件
 */
function buildRunSnapshot(runId, rankedPosts, quotaBreakdown = {}) {
  const shortcodeMap = {};  // shortcode → post_id
  const indexMap = {};      // final_rank → post_id

  const snapshotPosts = rankedPosts.map(post => {
    const sc = calcShortcode(post.id);
    shortcodeMap[sc] = post.id;
    indexMap[post.final_rank] = post.id;

    return {
      id: post.id,
      url: post.url,
      group: post.group_name || null,
      group_url: post.group_url || null,
      author: post.author || null,
      shortcode: sc,
      weight: post.group_weight ?? 1.0,
      rule_boost: post.rule_boost ?? 0,
      keyword_bonus: post.keyword_bonus ?? 0,
      novelty_penalty: post.novelty_penalty ?? 0,
      ai_score: post.importance_score ?? null,
      calibrated_score: post.calibrated_score ?? null,
      final_score: post.score ?? 0,
      final_rank: post.final_rank,
      section: post.section,
      quota_reason: post.rule_section || (post.importance_score != null ? 'ai' : 'rule'),
    };
  });

  return {
    run_id: runId,
    created_at: new Date().toISOString(),
    posts: snapshotPosts,
    top_picks_ids: rankedPosts.filter(p => p.section === 'top_picks').map(p => p.id),
    quota_breakdown: {
      must_include: quotaBreakdown.must_include ?? 0,
      ai: quotaBreakdown.ai ?? 0,
      rule: quotaBreakdown.rule ?? 0,
    },
    shortcode_map: shortcodeMap,  // shortcode → post_id（Phase 2 回覆解析用）
    index_map: indexMap,           // final_rank → post_id
  };
}

// ── HTML 版型 ─────────────────────────────────────────────────────────────────

/**
 * 產出 Email HTML（兩段式版型）
 *
 * @param {Array}  rankedPosts — 完整排序後的 posts（含 section, final_rank, shortcode 欄位）
 * @param {Object} digestConfig — { topPicksMax, everythingElseMax, subjectPrefix }
 * @param {Object} runStats    — { run_id, email_parse_ok_rate, high_conf_rate, ... }
 * @returns {{ html: string, text: string, subject: string }}
 */
function buildDigestEmail(rankedPosts, digestConfig, runStats) {
  const capPerSource = digestConfig.topPicksCapPerSource ?? 3;

  // Top Picks source caps（同一 source 最多 capPerSource 篇）
  // 溢出項目降到 Everything Else（保留原始分數，不丟棄）
  const { capped: topPicksCapped, overflow: capOverflow } = _applySourceCaps(
    rankedPosts.filter(p => p.section === 'top_picks'),
    capPerSource
  );

  // Everything Else = 原本 EE + caps 溢出（保留原始分數）
  const everythingElseBase = rankedPosts.filter(p => p.section === 'everything_else');
  const everythingElseMerged = [...everythingElseBase, ...capOverflow];

  const topPicks = topPicksCapped;
  const everythingElse = everythingElseMerged;
  const overflow = rankedPosts.filter(p => p.section === 'overflow');
  const totalCount = rankedPosts.length;

  const today = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

  const subject = `${digestConfig.subjectPrefix || '[SocialDigest]'} ${today}（${topPicks.length} picks + ${everythingElse.length} 則）`;

  // 先加 shortcode
  const topPicksWithSc = topPicks.map(p => ({ ...p, shortcode: p.shortcode || calcShortcode(p.id) }));
  const eeWithSc = everythingElse.map(p => ({ ...p, shortcode: p.shortcode || calcShortcode(p.id) }));

  const html = _buildHtml(topPicksWithSc, eeWithSc, overflow, totalCount, today, runStats);
  const text = _buildText(topPicksWithSc, eeWithSc, overflow, totalCount, today, runStats);

  return { subject, html, text };
}

// ── SendGrid 發信 ─────────────────────────────────────────────────────────────

/**
 * 發送 digest email（透過 SendGrid API，走 HTTPS port 443）
 *
 * @param {Object} smtpConfig — config.smtp（from agent's config.json）
 * @param {string} subject
 * @param {string} html
 * @param {string} text
 * @param {boolean} [dryRun=false] — true 時不實際發信，只回傳內容
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
async function sendDigest(smtpConfig, subject, html, text, dryRun = false) {
  if (dryRun) {
    return { ok: true, dry_run: true };
  }

  const sgMail = require('@sendgrid/mail');

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'SENDGRID_API_KEY not set' };
  }

  sgMail.setApiKey(apiKey);

  try {
    const [response] = await sgMail.send({
      from: smtpConfig.from || smtpConfig.user,
      to: smtpConfig.recipient,
      subject,
      html,
      text,
    });
    const messageId = response?.headers?.['x-message-id'] || '-';
    return { ok: true, messageId };
  } catch (err) {
    const detail = err.response?.body?.errors?.[0]?.message || err.message;
    return { ok: false, error: detail };
  }
}

// ── HTML 建構 ─────────────────────────────────────────────────────────────────

function _buildHtml(topPicks, everythingElse, overflow, totalCount, today, runStats) {
  const lines = [];
  lines.push(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; color: #333; line-height: 1.5; }
  h1 { font-size: 1.2em; border-bottom: 2px solid #1877f2; padding-bottom: 8px; color: #1877f2; }
  h2 { font-size: 1em; color: #555; margin-top: 28px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  h3 { font-size: 0.9em; color: #888; margin-top: 16px; margin-bottom: 4px; }
  .post { margin: 16px 0; padding: 12px; border-left: 3px solid #1877f2; background: #f8f9fa; border-radius: 4px; }
  .post-header { font-weight: bold; color: #222; margin-bottom: 6px; }
  .post-score { display: inline-block; background: #1877f2; color: white; padding: 2px 6px; border-radius: 10px; font-size: 0.85em; margin-right: 6px; }
  .post-group { color: #1877f2; font-weight: 600; }
  .post-author { color: #666; font-size: 0.9em; }
  .source-label { display: inline-block; background: #e8f0fe; color: #1a56db; padding: 1px 5px; border-radius: 3px; font-size: 0.78em; font-weight: 600; margin-right: 4px; font-family: monospace; }
  .shortcode { color: #aaa; font-size: 0.8em; font-family: monospace; }
  .snippet { color: #444; margin: 6px 0; font-size: 0.95em; }
  .summary { color: #333; margin: 6px 0; }
  .tags { color: #888; font-size: 0.85em; margin-top: 4px; }
  .link { display: inline-block; margin-top: 6px; color: #1877f2; text-decoration: none; font-size: 0.9em; }
  .ee-post { margin: 8px 0; font-size: 0.9em; border-bottom: 1px solid #f0f0f0; padding-bottom: 6px; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 0.8em; color: #999; }
  .overflow-notice { background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 8px 12px; margin: 12px 0; font-size: 0.85em; }
</style>
</head><body>`);

  lines.push(`<h1>📰 社群晨報 ${today}</h1>`);
  lines.push(`<p style="color:#888;font-size:0.9em">共收到 ${totalCount} 篇貼文</p>`);

  // ── Top Picks ──────────────────────────────────────────────────────────────
  lines.push(`<h2>⭐ Top Picks（${topPicks.length} 則）</h2>`);
  if (topPicks.length === 0) {
    lines.push('<p style="color:#aaa">今日無 Top Picks</p>');
  }
  for (const post of topPicks) {
    lines.push(_postToHtml(post, 'top_picks'));
  }

  // ── Everything Else（按 category 分段）─────────────────────────────────────
  if (everythingElse.length > 0) {
    lines.push(`<h2>📋 Everything Else（${everythingElse.length} 則）</h2>`);
    const segments = _segmentPosts(everythingElse);
    for (const { label, posts: segPosts } of segments) {
      if (segPosts.length > 0) {
        lines.push(`<h3>${label}（${segPosts.length}）</h3>`);
        for (const post of segPosts) {
          lines.push(_postToHtmlEE(post));
        }
      }
    }
  }

  // ── Overflow ──────────────────────────────────────────────────────────────
  if (overflow.length > 0) {
    lines.push(`<div class="overflow-notice">📌 本日共 ${totalCount} 篇，已列出 Top Picks ${topPicks.length} 篇 + Everything Else ${everythingElse.length} 篇，剩餘 <b>${overflow.length}</b> 篇未列出。完整清單見 latest.html。</div>`);
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  lines.push(_buildHtmlFooter(runStats));
  lines.push('</body></html>');
  return lines.join('\n');
}

function _postToHtml(post, section) {
  const score = post.calibrated_score ?? post.score ?? 0;
  const sourceLabel = _getSourceLabel(post.source);
  const group = _esc(post.group_name || post.group_url || '未知群組');
  const author = post.author ? `— ${_esc(post.author)}` : '';
  const sc = `[#${post.shortcode || calcShortcode(post.id)}]`;
  const content = post.summary || post.snippet || '';
  const tags = _parseTags(post.tags_json);
  const url = post.url;

  return `<div class="post">
  <div class="post-header">
    <span class="post-score">⭐${score}</span>
    <span class="source-label">${sourceLabel}</span>
    <span class="post-group">${group}</span>
    <span class="post-author">${author}</span>
    <span class="shortcode">${sc}</span>
  </div>
  ${content ? `<div class="summary">${_esc(content)}</div>` : ''}
  ${tags.length ? `<div class="tags">${tags.map(t => _esc(t)).join(' ')}</div>` : ''}
  <a class="link" href="${_esc(url)}" target="_blank">🔗 原文</a>
</div>`;
}

function _postToHtmlEE(post) {
  const sourceLabel = _getSourceLabel(post.source);
  const group = _esc(post.group_name || post.group_url || '未知群組');
  const author = post.author ? `— ${_esc(post.author)}` : '';
  const snippet = post.snippet ? `— ${_esc(post.snippet.slice(0, 80))}` : '';
  const sc = `[#${post.shortcode || calcShortcode(post.id)}]`;
  const url = post.url;

  return `<div class="ee-post">
  <span class="source-label">${sourceLabel}</span>
  <span class="post-group">${group}</span> <span class="post-author">${author}</span>
  <span class="snippet">${snippet}</span>
  <span class="shortcode">${sc}</span>
  <a href="${_esc(url)}" target="_blank">🔗</a>
</div>`;
}

function _buildHtmlFooter(runStats) {
  const stats = runStats || {};
  const lines = [
    '<div class="footer">',
    `<p>run_id: ${_esc(stats.run_id || '-')} | `,
    `parse_ok: ${_pct(stats.email_parse_ok_rate)} | `,
    `high_conf: ${_pct(stats.high_conf_rate)} | `,
    `l2: ${_pct(stats.l2_success_rate)}</p>`,
    '<p>Phase 2 回覆支援：回信輸入 GOOD #短碼 / MUTE #短碼（即將上線）</p>',
    '</div>',
  ];
  return lines.join('');
}

// ── 純文字版型 ────────────────────────────────────────────────────────────────

function _buildText(topPicks, everythingElse, overflow, totalCount, today, runStats) {
  const lines = [];
  lines.push(`📰 社群晨報 ${today}`);
  lines.push(`共 ${totalCount} 篇貼文`);
  lines.push('');

  lines.push(`⭐ TOP PICKS（${topPicks.length} 則）`);
  lines.push('═'.repeat(40));
  for (const post of topPicks) {
    const score = post.calibrated_score ?? post.score ?? 0;
    const label = _getSourceLabel(post.source);
    const group = post.group_name || post.group_url || '未知群組';
    const author = post.author ? ` — ${post.author}` : '';
    const sc = `[#${post.shortcode || calcShortcode(post.id)}]`;
    const content = post.summary || post.snippet || '';
    const tags = _parseTags(post.tags_json);

    lines.push(`[⭐${score}] ${label} ${group}${author} ${sc}`);
    if (content) lines.push(content);
    if (tags.length) lines.push(tags.join(' '));
    lines.push(`🔗 ${post.url}`);
    lines.push('');
  }

  if (everythingElse.length > 0) {
    lines.push(`📋 EVERYTHING ELSE（${everythingElse.length} 則）`);
    const segments = _segmentPosts(everythingElse);
    for (const { label: segLabel, posts: segPosts } of segments) {
      if (segPosts.length > 0) {
        lines.push(`── ${segLabel}（${segPosts.length}）`);
        for (const post of segPosts) {
          const srcLabel = _getSourceLabel(post.source);
          const group = post.group_name || post.group_url || '未知群組';
          const author = post.author ? ` — ${post.author}` : '';
          const snippet = post.snippet ? ` — ${post.snippet.slice(0, 80)}` : '';
          const sc = `[#${post.shortcode || calcShortcode(post.id)}]`;
          lines.push(`${srcLabel} ${group}${author}${snippet} ${sc} ${post.url}`);
        }
        lines.push('');
      }
    }
  }

  if (overflow.length > 0) {
    lines.push(`📌 本日共 ${totalCount} 篇，已列出 ${topPicks.length + everythingElse.length} 篇，剩餘 ${overflow.length} 篇未列出。`);
    lines.push('');
  }

  const stats = runStats || {};
  lines.push('─'.repeat(40));
  lines.push(`run_id: ${stats.run_id || '-'} | parse_ok: ${_pct(stats.email_parse_ok_rate)} | high_conf: ${_pct(stats.high_conf_rate)}`);
  lines.push('Phase 2 回覆支援：回信輸入 GOOD #短碼 / MUTE #短碼（即將上線）');

  return lines.join('\n');
}

// ── Publisher 輔助函式 ────────────────────────────────────────────────────────

/**
 * 來源標籤：post.source → [FB] / [HN] / [RSS] / [GH]
 */
function _getSourceLabel(source) {
  switch (source) {
    case 'l1_imap': return '[FB]';
    case 'hackernews': return '[HN]';
    case 'rss': return '[RSS]';
    case 'github_releases': return '[GH]';
    case 'github_trending': return '[GH]';
    default: return '[??]';
  }
}

/**
 * Everything Else 按 source category 分段
 * 順序：FB Groups → Hacker News → RSS & GitHub
 */
function _segmentPosts(posts) {
  const fb = posts.filter(p => p.source === 'l1_imap');
  const hn = posts.filter(p => p.source === 'hackernews');
  const rssGh = posts.filter(p => p.source === 'rss' || p.source === 'github_releases' || p.source === 'github_trending');

  return [
    { label: 'FB Groups', posts: fb },
    { label: 'Hacker News', posts: hn },
    { label: 'RSS & GitHub', posts: rssGh },
  ];
}

/**
 * Top Picks source caps
 * 同一 source 最多 capPerSource 篇進 Top Picks
 * 溢出項目保留原始分數移入 overflow（降至 Everything Else）
 *
 * @param {Array} topPicks — section=top_picks 的 posts（已按 score 排序）
 * @param {number} capPerSource — 每個 source 最多幾篇
 * @returns {{ capped: Array, overflow: Array }}
 */
function _applySourceCaps(topPicks, capPerSource) {
  const sourceCounts = {};
  const capped = [];
  const overflow = [];

  for (const post of topPicks) {
    const src = post.source || 'unknown';
    const count = sourceCounts[src] || 0;
    if (count < capPerSource) {
      capped.push(post);
      sourceCounts[src] = count + 1;
    } else {
      overflow.push(post);
    }
  }

  return { capped, overflow };
}

// ── 工具函式 ─────────────────────────────────────────────────────────────────

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _pct(v) {
  if (v == null) return 'n/a';
  return `${Math.round(v * 100)}%`;
}

function _parseTags(tagsJson) {
  if (!tagsJson) return [];
  try {
    const arr = JSON.parse(tagsJson);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// ── 模組匯出 ─────────────────────────────────────────────────────────────────

module.exports = {
  calcShortcode,
  buildRunSnapshot,
  buildDigestEmail,
  sendDigest,
  // 內部函式供測試使用
  _buildHtml,
  _buildText,
  _esc,
  _parseTags,
  _getSourceLabel,
  _segmentPosts,
  _applySourceCaps,
};
