/**
 * deduplicator.js — 跨通知去重（M7）
 *
 * 去重 key 優先級（全部經 url-normalizer 正規化）：
 *   1. sha256(canonical_url) — posts.id 主鍵（唯一真相）
 *   2. Message-ID            — IMAP 層去重（已在 IMAP collector 做；這裡做 SQLite 層補強）
 *   3. Fallback              — group_url + author + snippet_hash（L1 解析不完整時）
 *
 * 職責：
 *   - 接收 email-parser 解析出的 posts[]
 *   - 查詢 SQLite，過濾掉已存在的（不插入重複）
 *   - 回傳新貼文 + 統計數字
 *
 * 依賴：db.js（直接使用 DB 實例）
 */

'use strict';

const crypto = require('crypto');

// ── 主要 API ─────────────────────────────────────────────────────────────────

/**
 * 去重並插入新貼文到 SQLite。
 *
 * @param {Object}   db     — DB 實例（from db.js）
 * @param {Array}    posts  — email-parser 輸出的 posts[]
 * @param {string}   [firstSeenAt] — 覆蓋 first_seen_at（用於補漏/回填）
 * @returns {{
 *   newPosts: Array,      — 真正新增的貼文（已寫入 DB）
 *   duplicates: Array,    — 跳過的重複貼文
 *   stats: {
 *     input: number,
 *     new: number,
 *     dup_by_id: number,
 *     dup_by_message_id: number,
 *     dup_by_fallback: number,
 *   }
 * }}
 */
function dedup(db, posts, firstSeenAt = null) {
  const newPosts = [];
  const duplicates = [];
  const stats = {
    input: posts.length,
    new: 0,
    dup_by_id: 0,
    dup_by_message_id: 0,
    dup_by_fallback: 0,
  };

  // 批次去重（單一 transaction 提升效能）
  const insertBatch = db.db.transaction(() => {
    for (const post of posts) {
      const result = _checkAndInsert(db, post, firstSeenAt, stats);
      if (result.inserted) {
        newPosts.push(post);
      } else {
        duplicates.push({ post, reason: result.reason });
      }
    }
  });

  insertBatch();
  stats.new = newPosts.length;
  return { newPosts, duplicates, stats };
}

/**
 * 僅做去重判斷，不寫入 DB（dry-run / 預覽用）
 *
 * @param {Object} db
 * @param {Array}  posts
 * @returns {{ newPosts: Array, duplicates: Array, stats: Object }}
 */
function dedupDryRun(db, posts) {
  const newPosts = [];
  const duplicates = [];
  const stats = {
    input: posts.length,
    new: 0,
    dup_by_id: 0,
    dup_by_message_id: 0,
    dup_by_fallback: 0,
  };

  for (const post of posts) {
    const reason = _checkDuplicate(db, post, stats);
    if (!reason) {
      newPosts.push(post);
    } else {
      duplicates.push({ post, reason });
    }
  }
  stats.new = newPosts.length;
  return { newPosts, duplicates, stats };
}

// ── 內部函式 ─────────────────────────────────────────────────────────────────

/**
 * 檢查是否重複，若否則插入。
 * 在 transaction 內呼叫。
 */
function _checkAndInsert(db, post, firstSeenAt, stats) {
  const dummyStats = { dup_by_id: 0, dup_by_message_id: 0, dup_by_fallback: 0 };
  const reason = _checkDuplicate(db, post, dummyStats);

  // 累加 stats
  stats.dup_by_id += dummyStats.dup_by_id;
  stats.dup_by_message_id += dummyStats.dup_by_message_id;
  stats.dup_by_fallback += dummyStats.dup_by_fallback;

  if (reason) {
    return { inserted: false, reason };
  }

  // 插入新貼文
  const ts = firstSeenAt || new Date().toISOString();
  db.insertPost({
    ...post,
    first_seen_at: ts,
    created_at: ts,
  });
  return { inserted: true, reason: null };
}

/**
 * 回傳重複原因字串，若不重複回傳 null。
 * 按優先順序：id → message_id → fallback。
 */
function _checkDuplicate(db, post, stats) {
  // 1. 主鍵去重：sha256(canonical_url)
  if (post.id) {
    const existing = db.getPost(post.id);
    if (existing) {
      stats.dup_by_id++;
      return 'dup_by_id';
    }
  }

  // 2. Message-ID 去重（同一封 email 通知被重複抓取）
  if (post.raw_email_message_id) {
    if (db.postExistsByMessageId(post.raw_email_message_id)) {
      stats.dup_by_message_id++;
      return 'dup_by_message_id';
    }
  }

  // 3. Fallback 去重：group_url + author + snippet_hash
  //    （適用於 L1 URL 解析不完整，但文字一樣的情況）
  if (post.group_url && post.author && post.snippet_hash) {
    if (_existsByFallback(db, post.group_url, post.author, post.snippet_hash)) {
      stats.dup_by_fallback++;
      return 'dup_by_fallback';
    }
  }

  return null;
}

/**
 * Fallback 去重查詢
 */
function _existsByFallback(db, groupUrl, author, snippetHash) {
  const row = db.db.prepare(`
    SELECT id FROM posts
    WHERE group_url = ? AND author = ? AND snippet_hash = ?
    LIMIT 1
  `).get(groupUrl, author, snippetHash);
  return !!row;
}

// ── 模組匯出 ─────────────────────────────────────────────────────────────────

module.exports = {
  dedup,
  dedupDryRun,
  // 暴露內部函式供測試使用
  _checkDuplicate,
  _existsByFallback,
};
