/**
 * web-normalizer.js — Web 來源正規化 + 標準 post 物件產出
 *
 * 職責：
 * 1. canonical URL 正規化（保守策略：只移除白名單 tracking query）
 * 2. normalizeToPost(item, sourceConfig) → 標準 post 物件（依全域 Post 最小契約）
 * 3. makeSourceKey(sourceType, sourceId)
 * 4. ID schema：sha256(canonical_url) / fallback sha256(source_id + ":" + source_item_key)
 */

'use strict';

const crypto = require('crypto');
const { URL } = require('url');

// ── HTTPS_ONLY_HOSTS（全系統唯一一份）───────────────────────────────────────────

const HTTPS_ONLY_HOSTS = new Set([
  'github.com',
  'news.ycombinator.com',
  'hnrss.org',
  'openai.com',
  'anthropic.com',
  'simonwillison.net',
  'en.wikipedia.org',
]);

// ── 白名單 tracking query（只移除這些）──────────────────────────────────────────

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'ref', 'source', '__tn__', 'amp', 'outputType',
]);

// ── 工具函式 ─────────────────────────────────────────────────────────────────

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

/**
 * makeSourceKey — 全系統統一的 per-source key
 * @param {string} sourceType — collector type（如 'hackernews'）
 * @param {string} sourceId — sources.json 短 id（如 'hn_frontpage'）
 * @returns {string} e.g. "hackernews:hn_frontpage"
 */
function makeSourceKey(sourceType, sourceId) {
  return `${sourceType}:${sourceId}`;
}

/**
 * canonical URL 正規化（保守策略）
 * - 只移除白名單 tracking query
 * - 去掉 trailing slash
 * - m. → 去掉；www. 不動
 * - http → https：僅當 host 在 HTTPS_ONLY_HOSTS 內
 * @param {string} rawUrl
 * @returns {string|null}
 */
function canonicalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let urlStr = rawUrl.trim();
  if (!urlStr.startsWith('http')) return null;

  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }

  // m. subdomain → 去掉
  if (u.hostname.startsWith('m.')) {
    u.hostname = u.hostname.slice(2);
  }

  // http → https（僅 HTTPS_ONLY_HOSTS）
  if (u.protocol === 'http:' && HTTPS_ONLY_HOSTS.has(u.hostname)) {
    u.protocol = 'https:';
  }

  // 移除白名單 tracking params
  const keysToDelete = [];
  for (const key of u.searchParams.keys()) {
    if (TRACKING_PARAMS.has(key)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    u.searchParams.delete(key);
  }

  // 重建 search
  u.search = u.searchParams.toString() ? '?' + u.searchParams.toString() : '';

  // 去掉 fragment
  u.hash = '';

  // 去掉 trailing slash
  return u.toString().replace(/\/$/, '');
}

/**
 * 從 HTML 中移除 tag，留下純文字
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 截斷 snippet（HTML strip + 500 字元）
 */
function truncateSnippet(text, maxLen = 500) {
  const stripped = stripHtml(text);
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen) + '…';
}

/**
 * normalizeToPost — 將 web item 正規化為標準 post 物件
 *
 * @param {object} item — collector 解析出的 raw item
 * @param {object} item.title
 * @param {string|null} item.link — 原始 URL
 * @param {string|null} item.isoDate — ISO 日期
 * @param {string|null} item.pubDate — RFC 日期
 * @param {string|null} item.content — HTML 或文字內容
 * @param {string|null} item.contentSnippet — 純文字 snippet
 * @param {string|null} item.guid — RSS guid
 * @param {string|null} item.creator — 作者
 * @param {object} sourceConfig — sources.json 該 source 設定
 * @param {string} sourceConfig.id — 短 id
 * @param {string} sourceConfig.type — collector type
 * @param {string} sourceConfig.name — 顯示名稱
 * @param {object} [options]
 * @param {string} [options.source_item_key] — 由 collector 提供的 source_item_key
 * @param {boolean} [options.forceIdFallback] — 強制走 fallback ID（如 github_trending）
 * @returns {object} 標準 post 物件
 */
function normalizeToPost(item, sourceConfig, options = {}) {
  const sourceType = sourceConfig.type;
  const sourceId = sourceConfig.id;
  const fetchTime = new Date().toISOString();

  // URL 正規化
  const rawUrl = item.link || item.url || null;
  const canonicalUrl = rawUrl ? canonicalizeUrl(rawUrl) : null;

  // source_item_key（由 collector 提供或自動推斷）
  const sourceItemKey = options.source_item_key ||
    item.link || item.guid || `${item.title || ''}:${item.isoDate || item.pubDate || ''}`;

  // ID schema
  let id;
  if (options.forceIdFallback || !canonicalUrl) {
    id = sha256(`${sourceId}:${sourceItemKey}`);
  } else {
    id = sha256(canonicalUrl);
  }

  // published_at（fallback 順序依計劃規格）
  let publishedAt = null;
  let publishConfidence = 'HIGH';

  if (item.isoDate) {
    publishedAt = item.isoDate;
  } else if (item.pubDate || item.published) {
    const raw = item.pubDate || item.published;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      publishedAt = d.toISOString();
    }
  }

  if (!publishedAt) {
    publishedAt = fetchTime;
    publishConfidence = 'LOW';
  }

  // snippet
  const snippet = truncateSnippet(
    item.contentSnippet || item.content || item.description || ''
  );

  // group_name：sourceConfig.name → parsed group_name → source_id
  const groupName = sourceConfig.name || item.group_name || sourceId;

  // raw 物件（至少含 source_id, source_item_key）
  const raw = {
    source_id: sourceId,
    source_item_key: sourceItemKey,
    publish_confidence: publishConfidence,
  };

  // 保留有用的 raw 欄位（debug 用）
  if (item.guid) raw.guid = item.guid;
  if (item.link) raw.link = item.link;
  if (item.creator) raw.creator = item.creator;
  if (item.categories) raw.categories = item.categories;

  // raw JSON string 存 template_fp（web 來源）
  const rawJson = JSON.stringify(raw);
  const templateFp = rawJson.length <= 8192 ? rawJson : trimRawJson(raw);

  return {
    id,
    source: sourceType,
    url: canonicalUrl,
    raw_url: rawUrl,
    title: (item.title || '').trim() || `[${sourceType}] untitled`,
    published_at: publishedAt,
    snippet,
    group_name: groupName,
    group_url: null,
    author: item.creator || item.author || null,
    post_id: null, // web 來源不使用 post_id（保留給 IMAP）
    confidence: publishConfidence === 'LOW' ? 'LOW' : 'MED',
    template_fp: templateFp,
    raw_email_message_id: null,
    snippet_hash: snippet ? sha256(snippet).slice(0, 16) : null,
    first_seen_at: fetchTime,
    created_at: item.isoDate || fetchTime,
  };
}

/**
 * 裁剪 raw JSON（超 8KB 時）
 * 裁剪順序：snippet → html/description_html → etag/last_modified
 * 永不裁剪 source_id、source_item_key
 */
function trimRawJson(raw) {
  const trimmed = { ...raw };

  // 裁剪順序
  const trimOrder = ['snippet', 'html', 'description_html', 'content', 'etag', 'last_modified'];
  for (const key of trimOrder) {
    if (trimmed[key]) {
      delete trimmed[key];
      const json = JSON.stringify(trimmed);
      if (json.length <= 8192) return json;
    }
  }

  // 最後手段：只保留 source_id + source_item_key + publish_confidence
  return JSON.stringify({
    source_id: raw.source_id,
    source_item_key: raw.source_item_key,
    publish_confidence: raw.publish_confidence || 'LOW',
    _trimmed: true,
  });
}

module.exports = {
  canonicalizeUrl,
  normalizeToPost,
  makeSourceKey,
  sha256,
  stripHtml,
  truncateSnippet,
  HTTPS_ONLY_HOSTS,
};
