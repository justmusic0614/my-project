'use strict';

/**
 * feedback-collector.js — IMAP 回信解析 Feedback（M15）
 *
 * 從 IMAP feedbackLabel 收集回信，解析 GOOD/PIN/MUTE 指令。
 *
 * 設計重點：
 *   - C7: IMAP 搜尋 subject contains "[SocialDigest "，rid 用 regex 擷取
 *   - Review #11: tokenize 策略（非單一 regex），支援中文/全形/混合
 *   - B4: Snapshot fallback: rid → run-{rid}.json → latest.json → skip
 *   - E3: Message-ID 7 天去重（feedback-seen.json）
 *   - D4: click 事件 rank/section 為 NULL
 *   - Weight 調整 + 每日回歸（Review #5）
 */

const fs = require('fs');
const path = require('path');

const { FEEDBACK_ACTIONS } = require('../shared/contracts');

// ── Tokenize 解析 ─────────────────────────────────────────────────────────────

/**
 * ACTION tokens（case-insensitive）
 * 支援英文 + 中文別名
 */
const ACTION_MAP = {
  'good': 'good',
  '好': 'good',
  '讚': 'good',
  'pin': 'pin',
  '釘': 'pin',
  '置頂': 'pin',
  '必看': 'pin',
  'mute': 'mute',
  '靜音': 'mute',
  '隱藏': 'mute',
  '少推': 'mute',
};

const ACTION_REGEX = new RegExp(
  `\\b(${Object.keys(ACTION_MAP).filter(k => /^[a-z]+$/i.test(k)).join('|')})\\b`,
  'gi'
);
const ACTION_CJK_REGEX = new RegExp(
  `(${Object.keys(ACTION_MAP).filter(k => !/^[a-z]+$/i.test(k)).join('|')})`,
  'g'
);

/**
 * TARGET tokens：#XXXX（shortcode）或整數 1~60（序號）
 */
const SHORTCODE_REGEX = /#([A-Z0-9]{4})/gi;
const INDEX_REGEX = /\b(\d{1,2})\b/g;

/**
 * 從 subject 擷取 run_id
 * C7: \[SocialDigest\s+(\d{8})\]
 */
function extractRidFromSubject(subject) {
  if (!subject) return null;
  const m = subject.match(/\[SocialDigest\s+(\d{8})\]/);
  return m ? m[1] : null;
}

/**
 * 解析回信 body → feedback 指令陣列
 * tokenize 策略：逐行解析 ACTION + TARGETS
 *
 * @param {string} body - email body text
 * @returns {Array<{ action: string, targets: string[] }>}
 *   targets 為 shortcode（#XXXX）或序號字串（'3'）
 */
function parseReplyBody(body) {
  if (!body || typeof body !== 'string') return [];

  // 正規化：全形→半形，collapse 非換行空白
  const normalized = body
    .replace(/[\uff01-\uff5e]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/，/g, ',')
    .replace(/[^\S\n]+/g, ' ');

  const lines = normalized.split(/\n/);
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 找 ACTION
    let action = null;
    const enMatches = [...trimmed.matchAll(ACTION_REGEX)];
    const cjkMatches = [...trimmed.matchAll(ACTION_CJK_REGEX)];

    if (enMatches.length > 0) {
      action = ACTION_MAP[enMatches[0][1].toLowerCase()];
    } else if (cjkMatches.length > 0) {
      action = ACTION_MAP[cjkMatches[0][1]];
    }

    if (!action) continue;

    // 找 TARGETS
    const targets = [];

    // shortcodes: #XXXX
    const scMatches = [...trimmed.matchAll(SHORTCODE_REGEX)];
    for (const m of scMatches) {
      targets.push({ type: 'shortcode', value: m[1].toUpperCase() });
    }

    // 序號: 1~60 整數
    const idxMatches = [...trimmed.matchAll(INDEX_REGEX)];
    for (const m of idxMatches) {
      const num = parseInt(m[1], 10);
      if (num >= 1 && num <= 60) {
        targets.push({ type: 'index', value: String(num) });
      }
    }

    if (targets.length > 0) {
      results.push({ action, targets });
    }
  }

  return results;
}

// ── Snapshot 載入 ─────────────────────────────────────────────────────────────

/**
 * B4: Snapshot fallback — rid → run-{rid}.json → latest.json → null
 * @param {string} agentRoot
 * @param {string|null} rid
 * @returns {{ shortcode_map: object, index_map: object } | null}
 */
function loadSnapshot(agentRoot, rid) {
  const snapshotsDir = path.join(agentRoot, 'data/runtime/snapshots');

  if (rid) {
    const ridPath = path.join(snapshotsDir, `run-${rid}.json`);
    if (fs.existsSync(ridPath)) {
      try {
        return JSON.parse(fs.readFileSync(ridPath, 'utf8'));
      } catch { /* ignore */ }
    }
  }

  // fallback: latest.json
  const latestPath = path.join(snapshotsDir, 'latest.json');
  if (fs.existsSync(latestPath)) {
    try {
      return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    } catch { /* ignore */ }
  }

  return null;
}

// ── Message-ID 去重（E3）─────────────────────────────────────────────────────

/**
 * 載入 feedback-seen.json（Message-ID → timestamp）
 */
function loadSeen(agentRoot) {
  const seenPath = path.join(agentRoot, 'data/runtime/feedback-seen.json');
  if (!fs.existsSync(seenPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(seenPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * 儲存 feedback-seen.json（清除 > 7 天的條目）
 */
function saveSeen(agentRoot, seen) {
  const seenPath = path.join(agentRoot, 'data/runtime/feedback-seen.json');
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const cleaned = {};
  for (const [id, ts] of Object.entries(seen)) {
    if (ts > cutoff) cleaned[id] = ts;
  }
  fs.mkdirSync(path.dirname(seenPath), { recursive: true });
  fs.writeFileSync(seenPath, JSON.stringify(cleaned, null, 2), 'utf8');
}

// ── Weight 調整（Review #5）──────────────────────────────────────────────────

/**
 * 根據 feedback action 調整 source weight
 * good → +0.1, pin → +0.2, mute → -0.2
 * 約束 [0.2, 3.0]，每 source 每日最多一次
 *
 * @param {object} sm - SourceManager
 * @param {string} postId
 * @param {string} action
 * @param {object} db - DB instance
 * @param {Set<string>} adjustedToday - 今天已調過的 source keys
 */
function adjustWeight(sm, postId, action, db, adjustedToday) {
  const post = db.getPost(postId);
  if (!post || !post.group_url) return;

  const key = post.group_url.replace(/\/$/, '').toLowerCase();
  if (adjustedToday.has(key)) return; // 每日最多一次

  const delta = { good: 0.1, pin: 0.2, mute: -0.2 }[action];
  if (!delta) return;

  const source = sm.getByUrl(key);
  if (!source) return;

  const oldWeight = source.weight ?? 1.0;
  const newWeight = Math.max(0.2, Math.min(3.0, oldWeight + delta));
  sm.updateWeight(key, newWeight);
  adjustedToday.add(key);
}

/**
 * 每日 weight 回歸（Review #5 防堆積）
 * weight = 1.0 + (weight - 1.0) * 0.98
 */
function regressWeights(sm) {
  const sources = sm.getAll();
  for (const src of sources) {
    if (src.weight != null && src.weight !== 1.0) {
      const regressed = 1.0 + (src.weight - 1.0) * 0.98;
      const key = (src.url || '').replace(/\/$/, '').toLowerCase();
      sm.updateWeight(key, Math.round(regressed * 1000) / 1000);
    }
  }
}

// ── 主 API ────────────────────────────────────────────────────────────────────

/**
 * 收集 feedback（IMAP 回信解析）
 *
 * @param {object} db - DB instance
 * @param {object} sm - SourceManager
 * @param {string} agentRoot
 * @param {object} imapConfig
 * @returns {{ stats: object }}
 */
async function collectFeedback(db, sm, agentRoot, imapConfig) {
  const stats = {
    emails_checked: 0,
    feedback_parsed: 0,
    feedback_inserted: 0,
    feedback_rid_missing: 0,
    feedback_snapshot_missing: 0,
    feedback_dedup_skip: 0,
  };

  // 此處需要 IMAP 連線讀取 feedbackLabel
  // 完整 IMAP 實作需要 imapflow（Phase 2 部署時啟用）
  // 目前提供 parseFeedbackFromEmails() 供 agent.js 呼叫

  return { stats };
}

/**
 * 從已取得的 email 物件解析 feedback 並寫入 DB
 * 供 agent.js Step 0 呼叫（email 由 imap-collector 提供）
 *
 * @param {Array} emails - [{messageId, subject, text}]
 * @param {object} db - DB instance
 * @param {object} sm - SourceManager（weight 調整用）
 * @param {string} agentRoot
 * @returns {{ stats: object }}
 */
function parseFeedbackFromEmails(emails, db, sm, agentRoot) {
  const seen = loadSeen(agentRoot);
  const adjustedToday = new Set();
  const stats = {
    emails_checked: 0,
    feedback_parsed: 0,
    feedback_inserted: 0,
    feedback_rid_missing: 0,
    feedback_snapshot_missing: 0,
    feedback_dedup_skip: 0,
  };

  for (const email of emails) {
    stats.emails_checked++;

    // E3: Message-ID 去重
    if (email.messageId && seen[email.messageId]) {
      stats.feedback_dedup_skip++;
      continue;
    }

    // C7: 從 subject 擷取 rid
    const rid = extractRidFromSubject(email.subject);
    if (!rid) {
      stats.feedback_rid_missing++;
    }

    // B4: 載入 snapshot
    const snapshot = loadSnapshot(agentRoot, rid);
    if (!snapshot) {
      stats.feedback_snapshot_missing++;
      continue;
    }

    // 解析 body
    const commands = parseReplyBody(email.text || email.body || '');
    if (commands.length === 0) continue;

    stats.feedback_parsed += commands.length;

    for (const cmd of commands) {
      for (const target of cmd.targets) {
        let postId = null;

        if (target.type === 'shortcode') {
          postId = snapshot.shortcode_map?.[target.value] || null;
        } else if (target.type === 'index') {
          postId = snapshot.index_map?.[target.value] || null;
        }

        if (!postId) continue;

        // 插入 feedback（D4: click 的 rank/section NULL 由 redirect-server 負責）
        db.insertFeedback({
          run_id: rid || snapshot.run_id || null,
          post_id: postId,
          action: cmd.action,
        });
        stats.feedback_inserted++;

        // Weight 調整
        if (sm) {
          adjustWeight(sm, postId, cmd.action, db, adjustedToday);
        }
      }
    }

    // 記錄 seen
    if (email.messageId) {
      seen[email.messageId] = Date.now();
    }
  }

  saveSeen(agentRoot, seen);

  return { stats };
}

// ── Snapshot 清理（> 7 天）────────────────────────────────────────────────────

function cleanupSnapshots(agentRoot, maxAgeDays = 7) {
  const snapshotsDir = path.join(agentRoot, 'data/runtime/snapshots');
  if (!fs.existsSync(snapshotsDir)) return 0;

  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
  let cleaned = 0;

  for (const file of fs.readdirSync(snapshotsDir)) {
    if (file === 'latest.json') continue; // 不刪 latest
    const filePath = path.join(snapshotsDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      cleaned++;
    }
  }

  return cleaned;
}

module.exports = {
  extractRidFromSubject,
  parseReplyBody,
  loadSnapshot,
  parseFeedbackFromEmails,
  collectFeedback,
  adjustWeight,
  regressWeights,
  cleanupSnapshots,
  // 內部函式供測試
  loadSeen,
  saveSeen,
};
