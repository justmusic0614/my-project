/**
 * db.js — SQLite 存取層（M3）
 *
 * 提供 social-digest 的資料庫 CRUD 操作。
 * 使用 better-sqlite3（同步 API，適合 Node CLI）。
 *
 * Schema（Phase 1）：
 *   posts      — 貼文主表（sha256(canonical_url) 為主鍵）
 *   ai_results — AI 分類/摘要結果（快取，不重複送）
 *   feedback   — 使用者回饋（GOOD/PIN/MUTE/CLICK）
 *   runs       — 每次 run 的執行記錄與品質指標
 *
 * 依賴：better-sqlite3（npm install better-sqlite3）
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  raw_url TEXT,
  post_id TEXT,
  group_name TEXT,
  group_url TEXT,
  author TEXT,
  snippet TEXT,
  snippet_hash TEXT,
  source TEXT DEFAULT 'l1_imap',
  confidence TEXT DEFAULT 'MED',
  template_fp TEXT,
  raw_email_message_id TEXT,
  first_seen_at TEXT NOT NULL,
  created_at TEXT,
  l2_fetched_at TEXT,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_group_url ON posts(group_url);
CREATE INDEX IF NOT EXISTS idx_posts_first_seen_at ON posts(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_sent_at ON posts(sent_at);
CREATE INDEX IF NOT EXISTS idx_posts_raw_email_message_id ON posts(raw_email_message_id);

CREATE TABLE IF NOT EXISTS ai_results (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  category TEXT,
  summary TEXT,
  tags_json TEXT,
  importance_score INTEGER,
  ai_confidence TEXT,
  reasons_json TEXT,
  matched_rules_json TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  rank INTEGER,
  section TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_post_id ON feedback(post_id);
CREATE INDEX IF NOT EXISTS idx_feedback_run_id ON feedback(run_id);

CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT,
  ended_at TEXT,
  mail_count INTEGER,
  post_count INTEGER,
  new_post_count INTEGER,
  sent_count INTEGER,
  top_picks_count INTEGER,
  email_parse_ok_rate REAL,
  post_extract_ok_rate REAL,
  high_conf_rate REAL,
  l2_success_rate REAL,
  template_fp_stats TEXT,
  click_count INTEGER DEFAULT 0,
  top_picks_click_count INTEGER DEFAULT 0,
  good_count INTEGER DEFAULT 0,
  pin_count INTEGER DEFAULT 0,
  mute_count INTEGER DEFAULT 0,
  first_click_rank INTEGER,
  time_to_first_click_sec INTEGER,
  rules_version TEXT,
  errors TEXT
);
`;

// ── DB Class ─────────────────────────────────────────────────────────────────

class DB {
  /**
   * @param {string} dbPath — 絕對或相對路徑（相對於 agent root）
   */
  constructor(dbPath) {
    this.dbPath = path.resolve(dbPath);
    this._db = null;
  }

  // ── 連線管理 ──────────────────────────────────────────────────────────────

  open() {
    if (this._db) return this;
    // 確保目錄存在
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this._db = new Database(this.dbPath);
    this._migrate();
    return this;
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  get db() {
    if (!this._db) this.open();
    return this._db;
  }

  // ── Schema Migration ─────────────────────────────────────────────────────

  _migrate() {
    this._db.exec(SCHEMA_SQL);
  }

  // ── Posts ─────────────────────────────────────────────────────────────────

  /**
   * 插入貼文（忽略已存在的）
   * @returns {boolean} true = 新插入，false = 已存在
   */
  insertPost(post) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO posts
        (id, url, raw_url, post_id, group_name, group_url, author,
         snippet, snippet_hash, source, confidence, template_fp,
         raw_email_message_id, first_seen_at, created_at)
      VALUES
        (@id, @url, @raw_url, @post_id, @group_name, @group_url, @author,
         @snippet, @snippet_hash, @source, @confidence, @template_fp,
         @raw_email_message_id, @first_seen_at, @created_at)
    `);
    const result = stmt.run({
      id: post.id,
      url: post.url,
      raw_url: post.raw_url || null,
      post_id: post.post_id || null,
      group_name: post.group_name || null,
      group_url: post.group_url || null,
      author: post.author || null,
      snippet: post.snippet || null,
      snippet_hash: post.snippet_hash || null,
      source: post.source || 'l1_imap',
      confidence: post.confidence || 'MED',
      template_fp: post.template_fp || null,
      raw_email_message_id: post.raw_email_message_id || null,
      first_seen_at: post.first_seen_at || new Date().toISOString(),
      created_at: post.created_at || new Date().toISOString(),
    });
    return result.changes > 0;
  }

  /**
   * 以 id 查詢貼文
   */
  getPost(id) {
    return this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id) || null;
  }

  /**
   * 查詢未送出的貼文（sent_at IS NULL）
   */
  getUnsentPosts(limit = 500) {
    return this.db.prepare(`
      SELECT p.*, a.category, a.summary, a.tags_json, a.importance_score,
             a.ai_confidence, a.reasons_json, a.matched_rules_json
      FROM posts p
      LEFT JOIN ai_results a ON a.post_id = p.id
      WHERE p.sent_at IS NULL
      ORDER BY p.first_seen_at DESC
      LIMIT ?
    `).all(limit);
  }

  /**
   * 標記貼文已送出
   */
  markSent(postIds, sentAt = null) {
    const ts = sentAt || new Date().toISOString();
    const stmt = this.db.prepare('UPDATE posts SET sent_at = ? WHERE id = ?');
    const markMany = this.db.transaction((ids) => {
      for (const id of ids) stmt.run(ts, id);
    });
    markMany(postIds);
  }

  /**
   * 更新 L2 fetch 時間
   */
  markL2Fetched(postId, l2FetchedAt = null) {
    const ts = l2FetchedAt || new Date().toISOString();
    this.db.prepare('UPDATE posts SET l2_fetched_at = ? WHERE id = ?').run(ts, postId);
  }

  /**
   * 以 Message-ID 查詢是否存在（IMAP 層去重）
   */
  postExistsByMessageId(messageId) {
    const row = this.db.prepare(
      'SELECT id FROM posts WHERE raw_email_message_id = ? LIMIT 1'
    ).get(messageId);
    return !!row;
  }

  /**
   * 查詢需要 L2 fetch 的貼文（公開群組且 7 天內未抓）
   */
  getPostsForL2Fetch(publicGroupUrls, ttlDays = 7) {
    if (!publicGroupUrls || publicGroupUrls.length === 0) return [];
    const cutoff = new Date(Date.now() - ttlDays * 86400 * 1000).toISOString();
    const placeholders = publicGroupUrls.map(() => '?').join(',');
    return this.db.prepare(`
      SELECT id, url, group_url FROM posts
      WHERE group_url IN (${placeholders})
        AND (l2_fetched_at IS NULL OR l2_fetched_at < ?)
        AND sent_at IS NULL
    `).all([...publicGroupUrls, cutoff]);
  }

  /**
   * 查詢需要 AI 處理的貼文（未送出 + 無 ai_results）
   */
  getPostsForAI(limit = 200) {
    return this.db.prepare(`
      SELECT p.* FROM posts p
      LEFT JOIN ai_results a ON a.post_id = p.id
      WHERE p.sent_at IS NULL AND a.post_id IS NULL
      ORDER BY p.first_seen_at DESC
      LIMIT ?
    `).all(limit);
  }

  // ── AI Results ────────────────────────────────────────────────────────────

  /**
   * 插入 AI 結果（REPLACE 允許重跑）
   */
  upsertAiResult(result) {
    this.db.prepare(`
      INSERT OR REPLACE INTO ai_results
        (post_id, category, summary, tags_json, importance_score,
         ai_confidence, reasons_json, matched_rules_json, model, prompt_version, created_at)
      VALUES
        (@post_id, @category, @summary, @tags_json, @importance_score,
         @ai_confidence, @reasons_json, @matched_rules_json, @model, @prompt_version, @created_at)
    `).run({
      post_id: result.post_id,
      category: result.category || null,
      summary: result.summary || null,
      tags_json: Array.isArray(result.tags) ? JSON.stringify(result.tags) : (result.tags_json || null),
      importance_score: result.importance_score ?? null,
      ai_confidence: result.ai_confidence || 'MED',
      reasons_json: Array.isArray(result.reasons) ? JSON.stringify(result.reasons) : (result.reasons_json || null),
      matched_rules_json: Array.isArray(result.matched_rules) ? JSON.stringify(result.matched_rules) : (result.matched_rules_json || null),
      model: result.model || null,
      prompt_version: result.prompt_version || null,
      created_at: result.created_at || new Date().toISOString(),
    });
  }

  // ── Feedback ──────────────────────────────────────────────────────────────

  /**
   * 插入回饋記錄
   * action: 'good' | 'pin' | 'mute_group' | 'mute_topic' | 'click'
   */
  insertFeedback(fb) {
    this.db.prepare(`
      INSERT INTO feedback (run_id, post_id, action, rank, section, created_at)
      VALUES (@run_id, @post_id, @action, @rank, @section, @created_at)
    `).run({
      run_id: fb.run_id || null,
      post_id: fb.post_id || null,
      action: fb.action,
      rank: fb.rank ?? null,
      section: fb.section || null,
      created_at: fb.created_at || new Date().toISOString(),
    });
  }

  /**
   * 查詢某 run 的所有回饋
   */
  getFeedbackByRun(runId) {
    return this.db.prepare('SELECT * FROM feedback WHERE run_id = ?').all(runId);
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  /**
   * 建立 run 記錄（執行開始時）
   */
  startRun(runId) {
    this.db.prepare(`
      INSERT OR IGNORE INTO runs (run_id, started_at)
      VALUES (?, ?)
    `).run(runId, new Date().toISOString());
  }

  /**
   * 更新 run 記錄（執行完成時）
   */
  finishRun(runId, stats) {
    this.db.prepare(`
      UPDATE runs SET
        ended_at = @ended_at,
        mail_count = @mail_count,
        post_count = @post_count,
        new_post_count = @new_post_count,
        sent_count = @sent_count,
        top_picks_count = @top_picks_count,
        email_parse_ok_rate = @email_parse_ok_rate,
        post_extract_ok_rate = @post_extract_ok_rate,
        high_conf_rate = @high_conf_rate,
        l2_success_rate = @l2_success_rate,
        template_fp_stats = @template_fp_stats,
        rules_version = @rules_version,
        errors = @errors
      WHERE run_id = @run_id
    `).run({
      run_id: runId,
      ended_at: stats.ended_at || new Date().toISOString(),
      mail_count: stats.mail_count ?? null,
      post_count: stats.post_count ?? null,
      new_post_count: stats.new_post_count ?? null,
      sent_count: stats.sent_count ?? null,
      top_picks_count: stats.top_picks_count ?? null,
      email_parse_ok_rate: stats.email_parse_ok_rate ?? null,
      post_extract_ok_rate: stats.post_extract_ok_rate ?? null,
      high_conf_rate: stats.high_conf_rate ?? null,
      l2_success_rate: stats.l2_success_rate ?? null,
      template_fp_stats: stats.template_fp_stats
        ? JSON.stringify(stats.template_fp_stats)
        : null,
      rules_version: stats.rules_version || null,
      errors: stats.errors ? JSON.stringify(stats.errors) : null,
    });
  }

  /**
   * 取最新一筆 run 記錄
   */
  getLatestRun() {
    return this.db.prepare(`
      SELECT * FROM runs ORDER BY started_at DESC LIMIT 1
    `).get() || null;
  }

  /**
   * 查詢貼文的 topic_signature 群組（novelty 降權用）
   * topic_window_hours 內相同 tags_json hash 的貼文
   */
  getRecentTopicSignatures(windowHours = 24) {
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT a.tags_json, COUNT(*) as cnt
      FROM ai_results a
      JOIN posts p ON p.id = a.post_id
      WHERE p.first_seen_at >= ?
        AND a.tags_json IS NOT NULL
      GROUP BY a.tags_json
    `).all(since);
    // 返回 {tagsJson: count} map
    const map = {};
    for (const r of rows) {
      map[r.tags_json] = r.cnt;
    }
    return map;
  }

  /**
   * 查詢來源 signature（source_signature 降權用）
   * 同群組同作者在 windowDays 天內的出現次數
   */
  getRecentSourceSignatures(windowDays = 7) {
    const since = new Date(Date.now() - windowDays * 86400 * 1000).toISOString();
    const rows = this.db.prepare(`
      SELECT group_url, author, COUNT(*) as cnt
      FROM posts
      WHERE first_seen_at >= ?
        AND group_url IS NOT NULL
        AND author IS NOT NULL
      GROUP BY group_url, author
    `).all(since);
    const map = {};
    for (const r of rows) {
      map[`${r.group_url}::${r.author}`] = r.cnt;
    }
    return map;
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  /**
   * 執行任意 SQL（管理用）
   */
  exec(sql) {
    return this.db.exec(sql);
  }

  /**
   * 取得資料庫統計
   */
  stats() {
    const postCount = this.db.prepare('SELECT COUNT(*) as n FROM posts').get().n;
    const unsentCount = this.db.prepare('SELECT COUNT(*) as n FROM posts WHERE sent_at IS NULL').get().n;
    const runCount = this.db.prepare('SELECT COUNT(*) as n FROM runs').get().n;
    const latestRun = this.getLatestRun();
    return {
      post_count: postCount,
      unsent_count: unsentCount,
      run_count: runCount,
      latest_run_at: latestRun?.started_at || null,
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * 取得單例 DB（依 agentRoot 初始化）
 * @param {string} agentRoot — agent 根目錄（__dirname 上層）
 * @param {string|null} dbPath — 覆蓋路徑（測試用）
 */
function getDB(agentRoot, dbPath = null) {
  if (!_instance) {
    const resolvedPath = dbPath
      ? path.resolve(agentRoot, dbPath)
      : path.join(agentRoot, 'data', 'social-digest.db');
    _instance = new DB(resolvedPath);
    _instance.open();
  }
  return _instance;
}

function resetDB() {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

module.exports = { DB, getDB, resetDB };
