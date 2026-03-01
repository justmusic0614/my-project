/**
 * url-normalizer.js — URL 正規化（M5）
 *
 * 職責：
 * 1. 去掉所有 tracking query params（ref、__tn__、__cft__、fbclid 等）
 * 2. 統一 scheme（https）、去尾端 /
 * 3. m.facebook.com → www.facebook.com
 * 4. l.facebook.com/l.php?u=... → decode 出真正 URL
 * 5. 保留必要 ID params（story_fbid、id、permalink_id）
 * 6. 產出 canonical URL → sha256() 作為 posts.id
 */

'use strict';

const crypto = require('crypto');
const { URL } = require('url');

// ── Tracking params 黑名單 ────────────────────────────────────────────────────
const STRIP_PARAMS = new Set([
  // Facebook tracking
  '__tn__', '__cft__', '__xts__', 'fbclid', 'ref', 'refid', 'ref_component',
  'ref_page', 'ref_source', 'ref_type', '_rdc', '_rdr',
  // 通用 tracking
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'msclkid', 'mc_eid', 'mc_cid',
  // Facebook 通知 tracking
  'notif_t', 'notif_id', 'action_history', 'acontext',
]);

// ── 保留 ID params（去掉 tracking 後仍需保留）──────────────────────────────────
const KEEP_PARAMS = new Set([
  'story_fbid', 'id', 'permalink_id', 'set', 'type',
]);

// ── 正規化主函式 ──────────────────────────────────────────────────────────────

/**
 * 正規化 URL，回傳 canonical URL 字串。
 * 無法解析時回傳 null。
 * @param {string} rawUrl
 * @returns {string|null}
 */
function normalize(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  let urlStr = rawUrl.trim();

  // 補 scheme（裸 URL 如 //www.facebook.com/...）
  if (urlStr.startsWith('//')) urlStr = 'https:' + urlStr;
  if (!urlStr.startsWith('http')) urlStr = 'https://' + urlStr;

  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }

  // Step 1: l.facebook.com redirect → decode 真正 URL
  if (u.hostname === 'l.facebook.com' && u.pathname === '/l.php') {
    const target = u.searchParams.get('u');
    if (target) {
      try {
        const decoded = decodeURIComponent(target);
        return normalize(decoded); // 遞迴正規化真正目標
      } catch {
        return null;
      }
    }
  }

  // Step 2: 統一 hostname
  u.protocol = 'https:';
  if (u.hostname === 'm.facebook.com') u.hostname = 'www.facebook.com';
  if (u.hostname === 'web.facebook.com') u.hostname = 'www.facebook.com';

  // Step 3: 過濾 query params
  // Facebook 的 __cft__ 會以 __cft__[0] 形式出現，需做 prefix 比對
  const STRIP_PREFIXES = ['__cft__', '__xts__'];
  const newParams = new URLSearchParams();
  for (const [key, val] of u.searchParams.entries()) {
    if (STRIP_PARAMS.has(key)) continue;
    if (STRIP_PREFIXES.some(p => key.startsWith(p))) continue;
    // 保留 KEEP_PARAMS，其餘未知 params 也保留（保守策略）
    newParams.set(key, val);
  }
  u.search = newParams.toString() ? '?' + newParams.toString() : '';

  // Step 4: 去掉 fragment（# 之後）
  u.hash = '';

  // Step 5: 去尾端 /
  const canonical = u.toString().replace(/\/$/, '');
  return canonical;
}

/**
 * 計算 canonical URL 的 sha256 hash（作為 posts.id）
 * @param {string} canonicalUrl
 * @returns {string} hex sha256
 */
function sha256(canonicalUrl) {
  return crypto.createHash('sha256').update(canonicalUrl, 'utf8').digest('hex');
}

/**
 * 從 URL 擷取 Facebook post ID（輔助欄位）
 * 支援格式：
 *   /groups/{group_id}/permalink/{post_id}/
 *   story_fbid={post_id}
 *   /posts/{post_id}
 * @param {string} url — 已正規化的 URL
 * @returns {string|null}
 */
function extractPostId(url) {
  if (!url) return null;

  // /groups/.../permalink/{id}
  let m = url.match(/\/permalink\/(\d+)/);
  if (m) return m[1];

  // story_fbid=...
  try {
    const u = new URL(url);
    const fbid = u.searchParams.get('story_fbid');
    if (fbid) return fbid;
  } catch { /* ignore */ }

  // /posts/{id}
  m = url.match(/\/posts\/(\d+)/);
  if (m) return m[1];

  // /videos/{id}
  m = url.match(/\/videos\/(\d+)/);
  if (m) return m[1];

  return null;
}

/**
 * 從 URL 擷取 Facebook group URL（去掉貼文路徑，只保留群組根）
 * e.g. https://www.facebook.com/groups/123456/permalink/789 → https://www.facebook.com/groups/123456
 * @param {string} url — 已正規化的 URL
 * @returns {string|null}
 */
function extractGroupUrl(url) {
  if (!url) return null;
  const m = url.match(/^(https:\/\/www\.facebook\.com\/groups\/[^/?#]+)/);
  return m ? m[1] : null;
}

/**
 * 判斷 URL 是否為 Facebook 群組貼文連結（L1 主要目標）
 * @param {string} url
 * @returns {boolean}
 */
function isFbGroupPost(url) {
  if (!url) return false;
  return (
    url.includes('facebook.com/groups/') &&
    (url.includes('/permalink/') ||
     url.includes('story_fbid=') ||
     url.includes('/posts/'))
  );
}

/**
 * 完整處理一個原始 URL，回傳結構化結果
 * @param {string} rawUrl
 * @returns {{ canonical: string|null, id: string|null, post_id: string|null, group_url: string|null, is_fb_group_post: boolean }}
 */
function process(rawUrl) {
  const canonical = normalize(rawUrl);
  if (!canonical) {
    return { canonical: null, id: null, post_id: null, group_url: null, is_fb_group_post: false };
  }
  return {
    canonical,
    id: sha256(canonical),
    post_id: extractPostId(canonical),
    group_url: extractGroupUrl(canonical),
    is_fb_group_post: isFbGroupPost(canonical),
  };
}

module.exports = { normalize, sha256, extractPostId, extractGroupUrl, isFbGroupPost, process };
