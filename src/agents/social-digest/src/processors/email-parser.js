/**
 * email-parser.js — Facebook 通知信三層解析（M6）
 *
 * 三層解析策略（不依賴 HTML 結構，優先用穩定訊號）：
 *
 * Layer 1（最穩）：抽所有 <a> 連結 → 挑出貼文連結
 *   - 匹配 facebook.com/groups/.../permalink/... 或 story_fbid=
 *   - 經 url-normalizer 正規化
 *
 * Layer 2（中穩）：可見文字 / 純文字版
 *   - 找群組名、作者、摘要片段
 *
 * Layer 3（補強）：HTML pattern 比對
 *   - 抽 <title>、<meta>、寄件人等
 *
 * 每封信產出：
 *   - posts[]：{ url, canonical, id, post_id, group_name, group_url, author, snippet, confidence, template_fp }
 *   - confidence：HIGH / MED / LOW
 *   - template_fp：HTML 穩定 token 的 hash（偵測 FB 改模板用）
 *
 * 依賴：無外部套件（純 stdlib）
 */

'use strict';

const crypto = require('crypto');
const { normalize, sha256, extractPostId, extractGroupUrl, isFbGroupPost } = require('./url-normalizer');

// ── 常數 ──────────────────────────────────────────────────────────────────────

// FB 通知信中常見的穩定 CSS class / 文字標記（用於 template_fp）
const TEMPLATE_STABLE_TOKENS = [
  'notification@facebookmail.com',
  'facebookmail.com',
  'unsubscribe',
  'facebook.com/groups',
];

// Layer 1：貼文 URL 判斷（href 含這些 pattern 才是貼文連結）
const POST_URL_PATTERNS = [
  /facebook\.com\/groups\/[^/]+\/permalink\//i,
  /facebook\.com\/groups\/[^/]+\/posts\//i,
  /facebook\.com\/[^/]+\/posts\//i,
  /story_fbid=/i,
  /l\.facebook\.com\/l\.php.*facebook\.com.*groups/i,
];

// Layer 2：作者/群組名稱提取 regex（FB 通知信常見格式）
const AUTHOR_PATTERNS = [
  // "XXX posted in YYY"
  /^(.+?)\s+posted in\s+(.+?)(?:\s*[:\-]|$)/im,
  // "XXX 在 YYY 中發佈"
  /^(.+?)\s+在\s+(.+?)\s+中發佈/im,
  // "XXX commented on ..."
  /^(.+?)\s+(?:commented|replied|posted)/im,
];

// ── 主要解析函式 ──────────────────────────────────────────────────────────────

/**
 * 解析單封 Facebook 通知 email
 *
 * @param {Object} emailData
 * @param {string} emailData.html   — HTML body（可選）
 * @param {string} emailData.text   — plaintext body（可選）
 * @param {string} emailData.subject — 郵件主旨（可選）
 * @param {string} emailData.from   — 寄件人（可選）
 * @param {string} emailData.messageId — Message-ID header（可選）
 *
 * @returns {{
 *   posts: Array,
 *   confidence: 'HIGH'|'MED'|'LOW',
 *   template_fp: string,
 *   parse_ok: boolean,
 *   layers_hit: string[]
 * }}
 */
function parseEmail(emailData) {
  const { html = '', text = '', subject = '', from = '', messageId = '' } = emailData;

  const layersHit = [];
  // canonical → raw_url（以 canonical 為 key 去重，保留第一個原始 URL）
  const canonicalToRaw = new Map();
  let groupName = null;
  let author = null;
  let snippet = null;

  // ── Layer 1：從 HTML 抽 <a href> 連結 ─────────────────────────────────────
  if (html) {
    const hrefUrls = extractHrefs(html);
    for (const href of hrefUrls) {
      if (!isPostUrl(href)) continue;
      const canonical = normalize(href);
      if (canonical && !canonicalToRaw.has(canonical)) {
        canonicalToRaw.set(canonical, href);
      }
    }
    if (canonicalToRaw.size > 0) layersHit.push('L1_html_links');
  }

  // Layer 1b：從 plaintext 抽 URL（fallback）
  if (canonicalToRaw.size === 0 && text) {
    const textUrls = extractUrlsFromText(text);
    for (const url of textUrls) {
      if (!isPostUrl(url)) continue;
      const canonical = normalize(url);
      if (canonical && !canonicalToRaw.has(canonical)) {
        canonicalToRaw.set(canonical, url);
      }
    }
    if (canonicalToRaw.size > 0) layersHit.push('L1_text_links');
  }

  // ── Layer 2：從 plaintext 抽作者/群組名/摘要 ──────────────────────────────
  const bodyText = html ? stripHtml(html) : text;
  if (bodyText) {
    const extracted = extractTextFields(bodyText, subject);
    if (extracted.author) { author = extracted.author; layersHit.push('L2_author'); }
    if (extracted.groupName) { groupName = extracted.groupName; layersHit.push('L2_group'); }
    if (extracted.snippet) { snippet = extracted.snippet; layersHit.push('L2_snippet'); }
  }

  // ── Layer 3：從 HTML pattern 補充（subject / from / meta） ────────────────
  if (!groupName && subject) {
    const g = extractGroupFromSubject(subject);
    if (g) { groupName = g; layersHit.push('L3_subject_group'); }
  }
  if (!author && from) {
    // from 格式："Facebook <notification@facebookmail.com>" → 無用
    // 但有時 subject 含作者："John posted in ..."
    const a = extractAuthorFromSubject(subject);
    if (a) { author = a; layersHit.push('L3_subject_author'); }
  }

  // ── template_fp：HTML 穩定 token hash ─────────────────────────────────────
  const templateFp = calcTemplateFp(html || text);

  // ── 組裝 posts[] ────────────────────────────────────────────────────────────
  const posts = [];
  for (const [canonical, rawUrl] of canonicalToRaw.entries()) {
    const postId = extractPostId(canonical);
    const grpUrl = extractGroupUrl(canonical);

    // snippet hash（用於 fallback 去重）
    const snippetHash = snippet
      ? crypto.createHash('sha256').update(snippet.slice(0, 200), 'utf8').digest('hex').slice(0, 16)
      : null;

    posts.push({
      url: canonical,
      raw_url: rawUrl,
      id: sha256(canonical),
      post_id: postId,
      group_name: groupName || extractGroupNameFromUrl(grpUrl),
      group_url: grpUrl,
      author: author || null,
      snippet: snippet || null,
      snippet_hash: snippetHash,
      confidence: null,       // 由下面統一設定
      template_fp: templateFp,
      raw_email_message_id: messageId || null,
      source: 'l1_imap',
    });
  }

  // ── confidence 判斷 ────────────────────────────────────────────────────────
  const confidence = calcConfidence(posts, layersHit, canonicalToRaw.size);
  for (const p of posts) p.confidence = confidence;

  return {
    posts,
    confidence,
    template_fp: templateFp,
    parse_ok: posts.length > 0,
    layers_hit: layersHit,
  };
}

// ── Layer 1 helpers ───────────────────────────────────────────────────────────

/**
 * 從 HTML 抽取所有 href 屬性值
 */
function extractHrefs(html) {
  const hrefs = [];
  // 簡單 regex（不依賴 DOM parser）
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    hrefs.push(m[1].replace(/&amp;/g, '&'));
  }
  return hrefs;
}

/**
 * 從純文字抽取 URL（http/https 開頭）
 */
function extractUrlsFromText(text) {
  const re = /https?:\/\/[^\s<>"')\]]+/gi;
  return [...text.matchAll(re)].map(m => m[0]);
}

/**
 * 判斷 URL 是否符合 FB 群組貼文 pattern
 */
function isPostUrl(url) {
  return POST_URL_PATTERNS.some(re => re.test(url));
}

// ── Layer 2 helpers ───────────────────────────────────────────────────────────

/**
 * 從可見文字擷取 author / groupName / snippet
 */
function extractTextFields(bodyText, subject = '') {
  const result = { author: null, groupName: null, snippet: null };
  const combined = (subject + '\n' + bodyText).slice(0, 2000);

  for (const re of AUTHOR_PATTERNS) {
    const m = combined.match(re);
    if (m) {
      result.author = m[1]?.trim() || null;
      if (m[2]) result.groupName = m[2]?.trim() || null;
      break;
    }
  }

  // snippet：取去掉作者/群組行之後的第一段有意義文字（20~300 字）
  const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines) {
    if (line.length >= 20 && line.length <= 300) {
      // 排除導航/footer 類文字
      if (/unsubscribe|privacy|terms|copyright|facebook inc/i.test(line)) continue;
      if (/^\s*\d+\s*$/.test(line)) continue; // 純數字
      result.snippet = line;
      break;
    }
  }

  return result;
}

/**
 * 去掉 HTML tags，回傳可見文字
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Layer 3 helpers ───────────────────────────────────────────────────────────

/**
 * 從 subject 擷取群組名稱
 * 常見格式："New post in GroupName" / "GroupName 有新貼文"
 */
function extractGroupFromSubject(subject) {
  let m;
  m = subject.match(/new post in\s+(.+?)(?:\s*[-–]|$)/i);
  if (m) return m[1].trim();

  m = subject.match(/posted in\s+(.+?)(?:\s*[-–]|$)/i);
  if (m) return m[1].trim();

  m = subject.match(/(.+?)\s+有新貼文/i);
  if (m) return m[1].trim();

  m = subject.match(/在\s+(.+?)\s+中/i);
  if (m) return m[1].trim();

  return null;
}

/**
 * 從 subject 擷取作者
 * 常見格式："John posted in ..."
 */
function extractAuthorFromSubject(subject) {
  const m = subject.match(/^(.+?)\s+(?:posted|commented|replied|shared)/i);
  return m ? m[1].trim() : null;
}

/**
 * 從 group URL 擷取群組名稱（vanity name 或 ID）
 */
function extractGroupNameFromUrl(groupUrl) {
  if (!groupUrl) return null;
  const m = groupUrl.match(/\/groups\/([^/?#]+)/);
  return m ? m[1] : null;
}

// ── template_fp ───────────────────────────────────────────────────────────────

/**
 * 計算 HTML 模板指紋（穩定 token 的 sha256 前 12 字）
 * 目的：偵測 FB 改了 email 模板（template_fp 突然變多種 → high_conf_rate 下降告警）
 */
function calcTemplateFp(html) {
  // 抽取穩定 token（不含動態內容如用戶名、URL）
  const tokens = [];
  for (const tok of TEMPLATE_STABLE_TOKENS) {
    if (html.includes(tok)) tokens.push(tok);
  }
  // 加上 <table>/<td> 等結構標記的計數（粗略結構特徵）
  const tableCount = (html.match(/<table/gi) || []).length;
  const tdCount = (html.match(/<td/gi) || []).length;
  tokens.push(`t${tableCount}d${tdCount}`);

  const fingerprint = tokens.join('|');
  return crypto.createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 12);
}

// ── confidence ────────────────────────────────────────────────────────────────

/**
 * 根據解析結果判斷 confidence
 * HIGH：L1 找到貼文 URL + L2 找到 author 或 snippet
 * MED：只有 L1 找到 URL（沒有作者/摘要）
 * LOW：URL 來自 text 且沒有其他補充
 */
function calcConfidence(posts, layersHit, rawUrlCount) {
  if (posts.length === 0) return 'LOW';

  const hasHtmlLinks = layersHit.includes('L1_html_links');
  const hasAuthor = layersHit.some(l => l.includes('author'));
  const hasSnippet = layersHit.includes('L2_snippet');

  if (hasHtmlLinks && (hasAuthor || hasSnippet)) return 'HIGH';
  if (hasHtmlLinks) return 'MED';
  return 'LOW';
}

// ── 批次處理 ──────────────────────────────────────────────────────────────────

/**
 * 批次解析多封 email，回傳 { posts, stats }
 * @param {Array<Object>} emails — 每個元素同 parseEmail 的 emailData 格式
 * @returns {{ posts: Array, stats: Object }}
 */
function parseEmails(emails) {
  const allPosts = [];
  let parsedOk = 0;
  const templateFpCounts = {};

  for (const email of emails) {
    const result = parseEmail(email);
    allPosts.push(...result.posts);
    if (result.parse_ok) parsedOk++;

    // 累計 template_fp 統計
    const fp = result.template_fp;
    templateFpCounts[fp] = (templateFpCounts[fp] || 0) + 1;
  }

  const total = emails.length;
  const highConf = allPosts.filter(p => p.confidence === 'HIGH').length;

  return {
    posts: allPosts,
    stats: {
      total_emails: total,
      email_parse_ok_rate: total > 0 ? parsedOk / total : null,
      post_extract_ok_rate: allPosts.length > 0
        ? allPosts.filter(p => p.url && p.snippet).length / allPosts.length
        : null,
      high_conf_rate: allPosts.length > 0 ? highConf / allPosts.length : null,
      template_fp_stats: templateFpCounts,
    },
  };
}

module.exports = {
  parseEmail,
  parseEmails,
  // 暴露內部函式供測試使用
  _extractHrefs: extractHrefs,
  _stripHtml: stripHtml,
  _extractGroupFromSubject: extractGroupFromSubject,
  _extractAuthorFromSubject: extractAuthorFromSubject,
  _calcTemplateFp: calcTemplateFp,
  _calcConfidence: calcConfidence,
};
