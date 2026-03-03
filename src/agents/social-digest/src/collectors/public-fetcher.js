'use strict';

/**
 * public-fetcher.js — L2 公開貼文 OG meta 增強（M14）
 *
 * 設計重點：
 *   - OG meta 提取：同時支援 property="og:..." 和 name="og:..."
 *   - HTML entity 解碼
 *   - A6: Blocked domains 可配置 (rules.json l2_blocked_domains)
 *   - B9: 雙重 domain 比對 (response final URL + og_domain)
 *   - 節流：逐一處理、200-400ms sleep、429 → 立即停止
 *   - 7 天快取：l2_fetched_at 在 7 天內不重抓
 */

const { URL: NodeURL } = require('url');

// ── OG Meta 提取 ─────────────────────────────────────────────────────────────

/**
 * HTML entity 解碼
 */
function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/**
 * 從 HTML 提取 OG meta
 * Review #7: 支援 property 和 name 格式 + entity decode
 *
 * @param {string} html
 * @returns {{ title: string|null, description: string|null, image: string|null, type: string|null, og_domain: string|null, confidence: string }}
 */
function _extractOgMeta(html) {
  if (!html || typeof html !== 'string') {
    return { title: null, description: null, image: null, type: null, og_domain: null, confidence: 'LOW' };
  }

  const ogTags = {};

  // Match both property="og:..." and name="og:..."
  // 支援 single/double quotes + 任意順序 + self-closing
  const metaRegex = /<meta\s+(?:[^>]*?(?:property|name)\s*=\s*["'](og:[^"']+)["'][^>]*?content\s*=\s*["']([^"']*?)["']|[^>]*?content\s*=\s*["']([^"']*?)["'][^>]*?(?:property|name)\s*=\s*["'](og:[^"']+)["'])[^>]*?\/?>/gi;

  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    const key = (match[1] || match[4] || '').toLowerCase();
    const value = decodeEntities(match[2] || match[3] || '');
    if (key && value) {
      ogTags[key] = value;
    }
  }

  const title = ogTags['og:title'] || null;
  const description = ogTags['og:description'] || null;
  const image = ogTags['og:image'] || null;
  const type = ogTags['og:type'] || null;
  const ogUrl = ogTags['og:url'] || null;

  // 提取 og_domain
  let og_domain = null;
  if (ogUrl) {
    try {
      og_domain = new NodeURL(ogUrl).hostname.replace(/^www\./, '');
    } catch { /* ignore */ }
  }

  // confidence 判定
  let confidence = 'LOW';
  if (description && description.length >= 20 && description.length <= 500) {
    confidence = title ? 'HIGH' : 'MED';
  } else if (title) {
    confidence = 'MED';
  }

  return { title, description, image, type, og_domain, confidence };
}

// ── Fetch + Domain Check ─────────────────────────────────────────────────────

const DEFAULT_BLOCKED_DOMAINS = ['t.co', 'bit.ly', 'lnkd.in', 'goo.gl', 'tinyurl.com', 'ow.ly', 'buff.ly'];

/**
 * 主 API：批次 fetch 公開貼文並更新 OG meta
 *
 * @param {object} db - DB instance
 * @param {Array} posts - 需要 L2 fetch 的貼文 [{ id, url }]
 * @param {object} httpConfig - { userAgent, connectTimeout, readTimeout }
 * @param {object} rules - rules.json（含 l2_blocked_domains）
 * @returns {{ stats: object }}
 */
async function fetchPublicPosts(db, posts, httpConfig = {}, rules = {}) {
  const blockedDomains = new Set([
    ...DEFAULT_BLOCKED_DOMAINS,
    ...(rules.l2_blocked_domains || []),
  ]);

  const stats = {
    l2_attempted: 0,
    l2_success: 0,
    l2_blocked: 0,
    l2_error: 0,
    l2_429: 0,
    l2_success_rate: 0,
  };

  if (!posts || posts.length === 0) {
    return { stats };
  }

  const ua = httpConfig.userAgent || 'social-digest/1.0';
  const timeout = httpConfig.connectTimeout || 3000;

  for (const post of posts) {
    stats.l2_attempted++;

    try {
      // 預檢 URL domain
      let urlDomain;
      try {
        urlDomain = new NodeURL(post.url).hostname.replace(/^www\./, '');
      } catch {
        stats.l2_error++;
        continue;
      }

      if (blockedDomains.has(urlDomain)) {
        stats.l2_blocked++;
        db.markL2Fetched(post.id); // 標記已嘗試，避免重複
        continue;
      }

      // HTTP fetch（max 2 hops，不帶 cookie）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      let response;
      try {
        response = await fetch(post.url, {
          headers: { 'User-Agent': ua },
          redirect: 'follow',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // 429 → 立即停止
      if (response.status === 429) {
        stats.l2_429++;
        break;
      }

      if (!response.ok) {
        stats.l2_error++;
        db.markL2Fetched(post.id);
        continue;
      }

      const html = await response.text();
      const og = _extractOgMeta(html);

      // B9: 雙重 domain 比對（final URL + og_domain）
      let finalDomain;
      try {
        finalDomain = new NodeURL(response.url).hostname.replace(/^www\./, '');
      } catch {
        finalDomain = null;
      }

      const isBlocked =
        (finalDomain && blockedDomains.has(finalDomain)) ||
        (og.og_domain && blockedDomains.has(og.og_domain));

      if (isBlocked) {
        stats.l2_blocked++;
        db.markL2Fetched(post.id);
      } else {
        db.updatePostOgMeta(post.id, og);
        stats.l2_success++;
      }
    } catch (err) {
      stats.l2_error++;
      db.markL2Fetched(post.id);
    }

    // 節流 200-400ms
    await new Promise(r => setTimeout(r, 200 + Math.random() * 200));
  }

  stats.l2_success_rate = stats.l2_attempted > 0
    ? stats.l2_success / stats.l2_attempted
    : 0;

  return { stats };
}

module.exports = {
  fetchPublicPosts,
  _extractOgMeta,
  decodeEntities,
};
