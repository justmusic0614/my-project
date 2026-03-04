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

// ── Tracking URL 生成 ─────────────────────────────────────────────────────────

/**
 * 生成 HMAC sig（與 redirect-server.js 共用邏輯）
 * sig = hmac-sha256(secret, "${host}|${rid}:${code}").slice(0,16)
 */
function _generateSig(secret, host, rid, code) {
  return crypto.createHmac('sha256', secret)
    .update(`${host}|${rid}:${code}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * 把原始 URL wrap 成 redirect tracking URL
 * 若 tracking disabled 或缺少必要設定，回傳原始 URL
 *
 * @param {string} originalUrl
 * @param {string} shortcode
 * @param {string} rid
 * @param {object} trackingConfig - { enabled, host, redirectBaseUrl }
 * @returns {string}
 */
function _wrapTrackingUrl(originalUrl, shortcode, rid, trackingConfig) {
  if (!trackingConfig?.enabled) return originalUrl;
  const base = trackingConfig.redirectBaseUrl;
  const host = trackingConfig.host;
  const secret = process.env.REDIRECT_SECRET_CURRENT;
  if (!base || !host || !secret || !shortcode || !rid) return originalUrl;

  const sig = _generateSig(secret, host, rid, shortcode);
  return `${base}/r?c=${shortcode}&rid=${rid}&sig=${sig}`;
}

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
  const shortcodeMap = {};    // shortcode → post_id
  const indexMap = {};         // final_rank → post_id
  const shortcodeUrlMap = {}; // shortcode → url（C4: redirect 不查 DB）

  const snapshotPosts = rankedPosts.map(post => {
    const sc = calcShortcode(post.id);
    shortcodeMap[sc] = post.id;
    indexMap[post.final_rank] = post.id;
    if (post.url) shortcodeUrlMap[sc] = post.url;

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
    shortcode_map: shortcodeMap,      // shortcode → post_id（Phase 2 回覆解析用）
    index_map: indexMap,               // final_rank → post_id
    shortcode_url_map: shortcodeUrlMap, // C4: shortcode → url（redirect 用，不查 DB）
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
function buildDigestEmail(rankedPosts, digestConfig, runStats, trackingConfig = null) {
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

  // B3: subject 帶 rid — 回信 Re: 自動帶上，feedback collector 用 regex 擷取
  const rid = runStats?.run_id || '';
  const subject = `[SocialDigest ${rid}] ${today}（${topPicks.length} picks + ${everythingElse.length} 則）`;

  // 先加 shortcode
  const topPicksWithSc = topPicks.map(p => ({ ...p, shortcode: p.shortcode || calcShortcode(p.id) }));
  const eeWithSc = everythingElse.map(p => ({ ...p, shortcode: p.shortcode || calcShortcode(p.id) }));

  const html = _buildHtml(topPicksWithSc, eeWithSc, overflow, totalCount, today, runStats, rid, trackingConfig);
  const text = _buildText(topPicksWithSc, eeWithSc, overflow, totalCount, today, runStats, rid, trackingConfig);

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

function _buildHtml(topPicks, everythingElse, overflow, totalCount, today, runStats, rid = '', trackingConfig = null) {
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
    lines.push(_postToHtml(post, 'top_picks', rid, trackingConfig));
  }

  // ── Everything Else（按 category 分段）─────────────────────────────────────
  if (everythingElse.length > 0) {
    lines.push(`<h2>📋 Everything Else（${everythingElse.length} 則）</h2>`);
    const segments = _segmentPosts(everythingElse);
    for (const { label, posts: segPosts } of segments) {
      if (segPosts.length > 0) {
        lines.push(`<h3>${label}（${segPosts.length}）</h3>`);
        for (const post of segPosts) {
          lines.push(_postToHtmlEE(post, rid, trackingConfig));
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

function _postToHtml(post, section, rid = '', trackingConfig = null) {
  const score = post.calibrated_score ?? post.score ?? 0;
  const sourceLabel = _getSourceLabel(post.source);
  const group = _esc(post.group_name || post.group_url || '未知群組');
  const author = post.author ? `— ${_esc(post.author)}` : '';
  const shortcode = post.shortcode || calcShortcode(post.id);
  const sc = `[#${shortcode}]`;
  const content = post.summary || post.snippet || '';
  const tags = _parseTags(post.tags_json);
  const url = _wrapTrackingUrl(post.url, shortcode, rid, trackingConfig);

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

function _postToHtmlEE(post, rid = '', trackingConfig = null) {
  const sourceLabel = _getSourceLabel(post.source);
  const group = _esc(post.group_name || post.group_url || '未知群組');
  const author = post.author ? `— ${_esc(post.author)}` : '';
  const snippet = post.snippet ? `— ${_esc(post.snippet.slice(0, 80))}` : '';
  const shortcode = post.shortcode || calcShortcode(post.id);
  const sc = `[#${shortcode}]`;
  const url = _wrapTrackingUrl(post.url, shortcode, rid, trackingConfig);

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
    `<p>Run: ${_esc(stats.run_id || '-')} | `,
    `parse_ok: ${_pct(stats.email_parse_ok_rate)} | `,
    `high_conf: ${_pct(stats.high_conf_rate)} | `,
    `l2: ${_pct(stats.l2_success_rate)}</p>`,
    '<p style="margin-top:8px;color:#666;font-size:0.85em">',
    '📩 <b>回信即可回饋</b>（僅需一行）：<br>',
    '&nbsp;&nbsp;GOOD #A1B2（喜歡）<br>',
    '&nbsp;&nbsp;PIN&nbsp;&nbsp;#A1B2（置頂/必看）<br>',
    '&nbsp;&nbsp;MUTE #A1B2（少推同來源）<br>',
    '&nbsp;&nbsp;也可用序號：GOOD 3,7</p>',
    '</div>',
  ];
  return lines.join('');
}

// ── 純文字版型 ────────────────────────────────────────────────────────────────

function _buildText(topPicks, everythingElse, overflow, totalCount, today, runStats, rid = '', trackingConfig = null) {
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
    const shortcode = post.shortcode || calcShortcode(post.id);
    const sc = `[#${shortcode}]`;
    const content = post.summary || post.snippet || '';
    const tags = _parseTags(post.tags_json);
    const url = _wrapTrackingUrl(post.url, shortcode, rid, trackingConfig);

    lines.push(`[⭐${score}] ${label} ${group}${author} ${sc}`);
    if (content) lines.push(content);
    if (tags.length) lines.push(tags.join(' '));
    lines.push(`🔗 ${url}`);
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
          const eeShortcode = post.shortcode || calcShortcode(post.id);
          const sc = `[#${eeShortcode}]`;
          const eeUrl = _wrapTrackingUrl(post.url, eeShortcode, rid, trackingConfig);
          lines.push(`${srcLabel} ${group}${author}${snippet} ${sc} ${eeUrl}`);
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
  lines.push(`Run: ${stats.run_id || '-'} | parse_ok: ${_pct(stats.email_parse_ok_rate)} | high_conf: ${_pct(stats.high_conf_rate)}`);
  lines.push('');
  lines.push('回信即可回饋（僅需一行）：');
  lines.push('  GOOD #A1B2（喜歡）');
  lines.push('  PIN  #A1B2（置頂/必看）');
  lines.push('  MUTE #A1B2（少推同來源）');
  lines.push('  也可用序號：GOOD 3,7');

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
