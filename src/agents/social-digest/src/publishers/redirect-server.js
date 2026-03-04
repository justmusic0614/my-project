'use strict';

/**
 * redirect-server.js — Click Tracking + One-Click Feedback（M15）
 *
 * Node http.createServer()（無 Express 依賴）
 * - GET /r?c=XXXX&rid=20260304&sig=<hmac>              → 302 redirect + 記 click
 * - GET /f?action=good&c=XXXX&rid=20260304&sig=<hmac>  → 200 JSON + 記 feedback
 * - GET /health                                          → 200 ok
 *
 * HMAC 簽章：
 *   /r  sig = hmac-sha256(secret, `${host}|${rid}:${c}`)
 *   /f  sig = hmac-sha256(secret, `${host}|${rid}:${c}:${action}`)（action 納入防竄改）
 *
 * Click 去重（A2）：同 rid:post_id:click 10 分鐘內只算一次
 * Feedback 去重：同 rid:post_id:action 10 分鐘內只算一次
 * Prefetch 防護：偵測 scanner UA/headers → 200 skipped，不寫 DB
 * Snapshot 直查 shortcode_url_map / shortcode_map → 不查 DB（C4）
 *
 * 獨立 process，VPS 用 PM2 管理：
 *   node src/publishers/redirect-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const AGENT_ROOT = path.join(__dirname, '..', '..');

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const raw = fs.readFileSync(path.join(AGENT_ROOT, 'config.json'), 'utf8');
  const interpolated = raw.replace(/\$\{([^}:]+)(?::-(.*?))?\}/g, (_, name, def) => {
    const val = process.env[name];
    if (val !== undefined && val !== '') return val;
    if (def !== undefined) return def;
    return '';
  });
  return JSON.parse(interpolated);
}

// ── HMAC ──────────────────────────────────────────────────────────────────────

/**
 * 生成 HMAC sig（供 email-publisher 呼叫）
 * @param {string} secret
 * @param {string} host - config.tracking.host
 * @param {string} rid  - run_id
 * @param {string} code - shortcode
 * @returns {string} hex hmac
 */
function generateSig(secret, host, rid, code) {
  return crypto.createHmac('sha256', secret)
    .update(`${host}|${rid}:${code}`)
    .digest('hex')
    .slice(0, 16); // 取前 16 hex = 64 bits，夠防灌
}

/**
 * 生成 /f feedback sig（action 納入簽章，防竄改）
 * sig_f = hmac-sha256(secret, `${host}|${rid}:${code}:${action}`)
 */
function generateFeedbackSig(secret, host, rid, code, action) {
  return crypto.createHmac('sha256', secret)
    .update(`${host}|${rid}:${code}:${action}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * 驗證 HMAC sig（B1 雙 key 輪替）
 * @param {string} sig
 * @param {string} host
 * @param {string} rid
 * @param {string} code
 * @returns {boolean}
 */
function verifySig(sig, host, rid, code) {
  const current = process.env.REDIRECT_SECRET_CURRENT;
  const prev = process.env.REDIRECT_SECRET_PREV;

  if (current && generateSig(current, host, rid, code) === sig) return true;
  if (prev && generateSig(prev, host, rid, code) === sig) return true;
  return false;
}

/**
 * 驗證 /f feedback sig（雙 key 輪替）
 */
function verifyFeedbackSig(sig, host, rid, code, action) {
  const current = process.env.REDIRECT_SECRET_CURRENT;
  const prev = process.env.REDIRECT_SECRET_PREV;

  if (current && generateFeedbackSig(current, host, rid, code, action) === sig) return true;
  if (prev && generateFeedbackSig(prev, host, rid, code, action) === sig) return true;
  return false;
}

// ── Prefetch 防護 ─────────────────────────────────────────────────────────────

const PREFETCH_UA_KEYWORDS = [
  'safelinks', 'proofpoint', 'mimecast', 'barracuda',
  'microsoft office', 'outlook', 'google-inspectiontool', 'googleimageproxy',
];

function isPrefetch(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  if (PREFETCH_UA_KEYWORDS.some(k => ua.includes(k))) return true;

  const purpose = req.headers['purpose'] || req.headers['sec-purpose'] || req.headers['x-purpose'] || '';
  if (purpose.toLowerCase().includes('prefetch') || purpose.toLowerCase().includes('preview')) return true;

  return false;
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

/**
 * 載入 snapshot 的 shortcode_url_map
 * 路徑：data/runtime/snapshots/run-{rid}.json → latest.json fallback
 */
function loadSnapshotUrlMap(rid) {
  const snapshotsDir = path.join(AGENT_ROOT, 'data/runtime/snapshots');

  // 嘗試 run-{rid}.json
  const ridPath = path.join(snapshotsDir, `run-${rid}.json`);
  if (fs.existsSync(ridPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(ridPath, 'utf8'));
      return snap.shortcode_url_map || null;
    } catch { /* ignore */ }
  }

  // fallback: latest.json
  const latestPath = path.join(snapshotsDir, 'latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      return snap.shortcode_url_map || null;
    } catch { /* ignore */ }
  }

  return null;
}

// ── Server ────────────────────────────────────────────────────────────────────

function startServer(port = 3100) {
  const config = loadConfig();
  const trackingHost = config.tracking?.host || 'localhost';

  // 載入 DB（click 去重 + 記錄用）
  const { getDB } = require('../shared/db');
  const db = getDB(AGENT_ROOT, config.db?.path);

  const stats = {
    redirect_ok: 0, redirect_invalid_sig: 0, redirect_unresolved: 0,
    feedback_ok: 0, feedback_dedup: 0, feedback_prefetch_skipped: 0,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stats }));
      return;
    }

    // Redirect endpoint
    if (url.pathname === '/r') {
      const code = url.searchParams.get('c');
      const rid = url.searchParams.get('rid');
      const sig = url.searchParams.get('sig');

      if (!code || !rid || !sig) {
        stats.redirect_invalid_sig++;
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad request: missing params');
        return;
      }

      // A1: HMAC 驗證
      if (!verifySig(sig, trackingHost, rid, code)) {
        stats.redirect_invalid_sig++;
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid signature');
        return;
      }

      // C4: 從 snapshot 查 URL（不查 DB）
      const urlMap = loadSnapshotUrlMap(rid);
      if (!urlMap || !urlMap[code]) {
        stats.redirect_unresolved++;
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const targetUrl = urlMap[code];

      // A2: Click 去重（10 分鐘內同 rid:post_id 只算一次）
      // 需要 shortcode → post_id 映射
      const snapshotsDir = path.join(AGENT_ROOT, 'data/runtime/snapshots');
      let postId = null;
      try {
        const ridPath = path.join(snapshotsDir, `run-${rid}.json`);
        const latestPath = path.join(snapshotsDir, 'latest.json');
        const snapPath = fs.existsSync(ridPath) ? ridPath : latestPath;
        const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
        postId = snap.shortcode_map?.[code] || null;
      } catch { /* ignore */ }

      if (postId) {
        // C5: created_at 固定用 datetime('now')
        const recent = db.db.prepare(`
          SELECT 1 FROM feedback
          WHERE run_id = ? AND post_id = ? AND action = 'click'
            AND created_at > datetime('now', '-10 minutes')
          LIMIT 1
        `).get(rid, postId);

        if (!recent) {
          // D4: click 的 rank/section 為 NULL
          db.insertFeedback({
            run_id: rid,
            post_id: postId,
            action: 'click',
            created_at: undefined, // 讓 DB default datetime('now')
          });
        }
      }

      stats.redirect_ok++;

      // E1: Cache-Control 避免 link preview 假 click
      res.writeHead(302, {
        'Location': targetUrl,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end();
      return;
    }

    // ── /f: One-Click Feedback endpoint ──────────────────────────────────────
    if (url.pathname === '/f') {
      const code = url.searchParams.get('c');
      const rid = url.searchParams.get('rid');
      const action = url.searchParams.get('action');
      const sig = url.searchParams.get('sig');

      const FEEDBACK_HEADERS = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      };

      // Step 1: 必要參數
      if (!code || !rid || !action || !sig) {
        res.writeHead(400, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'missing params' }));
        return;
      }

      // Step 2: action validate
      if (!['good', 'pin', 'mute'].includes(action)) {
        res.writeHead(400, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'invalid action' }));
        return;
      }

      // Step 3: HMAC 驗章（sig_f 含 action）
      if (!verifyFeedbackSig(sig, trackingHost, rid, code, action)) {
        stats.redirect_invalid_sig++;
        res.writeHead(400, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'invalid signature' }));
        return;
      }

      // Step 4: 載入 snapshot
      const snapshotsDirF = path.join(AGENT_ROOT, 'data/runtime/snapshots');
      let snapF = null;
      try {
        const ridPathF = path.join(snapshotsDirF, `run-${rid}.json`);
        if (fs.existsSync(ridPathF)) {
          snapF = JSON.parse(fs.readFileSync(ridPathF, 'utf8'));
        }
      } catch { /* ignore */ }

      if (!snapF) {
        res.writeHead(404, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'snapshot not found' }));
        return;
      }

      // Step 5: 解析 post_id
      const postIdF = snapF.shortcode_map?.[code] || null;
      if (!postIdF) {
        res.writeHead(404, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'shortcode not found' }));
        return;
      }

      // Step 6: Prefetch 防護
      if (isPrefetch(req)) {
        stats.feedback_prefetch_skipped++;
        res.writeHead(200, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: true, skipped: 'prefetch' }));
        return;
      }

      // Step 7: Dedup（同 rid:post_id:action 10 分鐘內只算一次）
      const recentF = db.db.prepare(`
        SELECT 1 FROM feedback
        WHERE run_id = ? AND post_id = ? AND action = ?
          AND created_at > datetime('now', '-10 minutes')
        LIMIT 1
      `).get(rid, postIdF, action);

      if (recentF) {
        stats.feedback_dedup++;
        res.writeHead(200, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: true, action, dedup: true }));
        return;
      }

      // Step 8: Transaction — INSERT feedback + UPDATE source weight
      const delta = action === 'pin' ? 0.2 : action === 'good' ? 0.1 : -0.2;

      try {
        db.db.transaction(() => {
          // INSERT feedback
          db.insertFeedback({ run_id: rid, post_id: postIdF, action });

          // 查 source_id
          const postRow = db.db.prepare('SELECT source_id FROM posts WHERE id = ?').get(postIdF);
          if (postRow?.source_id) {
            db.db.prepare(
              'UPDATE sources SET weight = min(3.0, max(0.2, weight + ?)) WHERE id = ?'
            ).run(delta, postRow.source_id);
          }
        })();
      } catch (err) {
        res.writeHead(500, FEEDBACK_HEADERS);
        res.end(JSON.stringify({ ok: false, error: 'db error' }));
        return;
      }

      stats.feedback_ok++;
      res.writeHead(200, FEEDBACK_HEADERS);
      res.end(JSON.stringify({ ok: true, action }));
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, () => {
    console.log(`[redirect-server] Listening on port ${port}`);
  });

  return server;
}

// ── CLI 入口 ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const port = parseInt(process.env.REDIRECT_PORT || '3100', 10);
  startServer(port);
}

module.exports = { startServer, generateSig, generateFeedbackSig, verifySig, verifyFeedbackSig, loadSnapshotUrlMap };
