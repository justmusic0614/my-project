#!/usr/bin/env node
/**
 * social-digest Agent — CLI 入口（M2）
 *
 * 用法：
 *   node agent.js run                    # 正常執行（IMAP + AI + Email）
 *   node agent.js run --dry-run          # 不寄信，產出 latest.html preview
 *   node agent.js run --backfill-hours 24  # 擴大 internalDate 視窗補漏
 *   node agent.js status                 # 顯示上次 run 狀態
 *   node agent.js db-stats               # 顯示資料庫統計
 *   node agent.js help                   # 顯示說明
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENT_ROOT = __dirname;
const configPath = path.join(AGENT_ROOT, 'config.json');

// ── 載入 config（含環境變數替換）──────────────────────────────────────────────

function loadConfig() {
  const raw = fs.readFileSync(configPath, 'utf8');
  // 替換 ${VAR} 和 ${VAR:-default}
  const interpolated = raw.replace(/\$\{([^}:]+)(?::-(.*?))?\}/g, (_, name, def) => {
    const val = process.env[name];
    if (val !== undefined && val !== '') return val;
    if (def !== undefined) return def;
    return '';
  });
  return JSON.parse(interpolated);
}

const config = loadConfig();

// ── Logger（輕量版，依賴 market-digest shared logger 的風格）─────────────────

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const logLevel = LOG_LEVELS[config.logging?.level || 'info'] ?? 1;

function log(level, msg, ctx = {}) {
  if ((LOG_LEVELS[level] ?? 0) < logLevel) return;
  const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  const icons = { debug: '🔍', info: 'ℹ️ ', warn: '⚠️ ', error: '❌' };
  const ctxStr = Object.keys(ctx).length
    ? ' ' + Object.entries(ctx).map(([k, v]) => `${k}=${v}`).join(', ')
    : '';
  process.stderr.write(`${icons[level] || ''} [${ts}] [social-digest] ${msg}${ctxStr}\n`);
}

// ── 生成 run_id ───────────────────────────────────────────────────────────────

function newRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const rand = crypto.randomBytes(3).toString('hex');
  return `run-${ts}-${rand}`;
}

// ── 狀態管理 ─────────────────────────────────────────────────────────────────

const runtimePath = path.join(AGENT_ROOT, config.paths?.runtime || 'data/runtime');
const latestJsonPath = path.join(runtimePath, 'latest.json');

function loadLatest() {
  if (!fs.existsSync(latestJsonPath)) return {};
  return JSON.parse(fs.readFileSync(latestJsonPath, 'utf8'));
}

function saveLatest(data) {
  fs.mkdirSync(runtimePath, { recursive: true });
  fs.writeFileSync(latestJsonPath, JSON.stringify(data, null, 2), 'utf8');
}

// ── run 主流程（Phase 1 骨架，子模組 Phase 2 接入）──────────────────────────────

async function run(args) {
  const dryRun = args.includes('--dry-run');
  const backfillIdx = args.indexOf('--backfill-hours');
  const backfillHours = backfillIdx >= 0 ? parseInt(args[backfillIdx + 1], 10) || 24 : null;

  const runId = newRunId();
  log('info', `開始 run ${runId}`, {
    dryRun,
    backfillHours: backfillHours ?? 'none',
  });

  // ── 載入基礎模組 ─────────────────────────────────────────────────────────
  const { getDB } = require('./src/shared/db');
  const { SourceManager } = require('./src/shared/source-manager');

  const dbPath = path.join(AGENT_ROOT, config.db?.path || 'data/social-digest.db');
  const db = getDB(AGENT_ROOT, config.db?.path);
  const sm = new SourceManager(path.join(AGENT_ROOT, 'data/sources.json'));

  db.startRun(runId);

  const stats = {
    run_id: runId,
    started_at: new Date().toISOString(),
    mail_count: 0,
    post_count: 0,
    new_post_count: 0,
    sent_count: 0,
    top_picks_count: 0,
    email_parse_ok_rate: null,
    post_extract_ok_rate: null,
    high_conf_rate: null,
    l2_success_rate: null,
    errors: [],
  };

  // ── Phase 1 Stub：等待 M4+ 接入 ──────────────────────────────────────────
  // 各步驟以 try/catch 包覆，保證部分失敗不影響後續步驟
  const enabledSources = sm.getEnabled();
  log('info', `載入群組來源`, { count: enabledSources.length });

  if (enabledSources.length === 0) {
    log('warn', '沒有啟用的群組來源，請先編輯 data/sources.json');
  }

  // TODO (M4): IMAP 收信
  // const imapCollector = require('./src/collectors/imap-collector');
  // const { emails, watermark } = await imapCollector.collect(config.imap, loadLatest(), backfillHours);

  // TODO (M5/M6): URL normalizer + Email parser
  // TODO (M7): 去重（deduplicator）
  // TODO (M8): Rule filter
  // TODO (M10): Post scorer
  // TODO (M13, Phase 2): AI summarizer
  // TODO (M9): Email publisher

  // ── 完成：更新 latest.json 水位線 ─────────────────────────────────────────
  // 只在成功跑完才更新水位線（不在中途更新）
  const prev = loadLatest();
  const ended = new Date().toISOString();
  stats.ended_at = ended;

  const rules = JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, 'data/rules.json'), 'utf8'));
  stats.rules_version = rules.version || null;

  db.finishRun(runId, stats);

  const nextLatest = {
    // 水位線三件套（Phase 1 骨架保持上一次的值）
    imap_last_uid: prev.imap_last_uid ?? null,
    imap_last_internal_date: prev.imap_last_internal_date ?? null,
    imap_last_message_id: prev.imap_last_message_id ?? null,
    // 執行狀態
    last_run_id: runId,
    last_run_at: ended,
    last_run_status: 'ok',
    mail_count: stats.mail_count,
    post_count: stats.post_count,
    new_post_count: stats.new_post_count,
    sent_count: stats.sent_count,
    email_parse_ok_rate: stats.email_parse_ok_rate,
    post_extract_ok_rate: stats.post_extract_ok_rate,
    high_conf_rate: stats.high_conf_rate,
    l2_success_rate: stats.l2_success_rate,
  };
  saveLatest(nextLatest);

  if (dryRun) {
    log('info', '[dry-run] 完成，未寄信（latest.html TODO M9）');
  } else {
    log('info', `run 完成`, {
      run_id: runId,
      new_posts: stats.new_post_count,
      sent: stats.sent_count,
    });
  }

  return { ok: true, run_id: runId, stats };
}

// ── status ────────────────────────────────────────────────────────────────────

function status() {
  const latest = loadLatest();
  if (!latest.last_run_id) {
    return { ok: true, message: '尚無執行記錄', latest };
  }
  return { ok: true, latest };
}

// ── db-stats ──────────────────────────────────────────────────────────────────

function dbStats() {
  const { getDB } = require('./src/shared/db');
  const db = getDB(AGENT_ROOT, config.db?.path);
  return db.stats();
}

// ── help ──────────────────────────────────────────────────────────────────────

function help() {
  return [
    'social-digest agent v1.0.0',
    '',
    'Commands:',
    '  run                    — 正常執行（IMAP + AI + Email）',
    '  run --dry-run          — 不寄信，產出 latest.html preview',
    '  run --backfill-hours N — 擴大 internalDate 視窗補漏（N 小時）',
    '  status                 — 顯示上次 run 狀態',
    '  db-stats               — 顯示資料庫統計',
    '  help                   — 顯示此說明',
    '',
    '環境變數（需設定於 .env 或 shell）：',
    '  GMAIL_IMAP_USER        — Gmail 帳號',
    '  GMAIL_IMAP_PASSWORD    — Gmail App Password',
    '  GMAIL_SMTP_USER        — SMTP 帳號（通常同 IMAP）',
    '  GMAIL_SMTP_PASSWORD    — SMTP App Password',
    '  DIGEST_RECIPIENT       — 收件人 email',
    '  OPENAI_API_KEY         — AI 摘要用（Phase 2）',
    '  IMAP_LABEL             — Gmail label 名稱（預設 FB-Groups）',
    '  LOG_LEVEL              — debug / info / warn / error',
  ].join('\n');
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

async function main() {
  const [command, ...args] = process.argv.slice(2);

  try {
    let result;
    switch (command) {
      case 'run':
        result = await run(args);
        break;
      case 'status':
        result = status();
        break;
      case 'db-stats':
        result = dbStats();
        break;
      case 'help':
      default:
        result = help();
        break;
    }

    if (typeof result === 'string') {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    log('error', `未預期錯誤: ${err.message}`);
    if (process.env.LOG_LEVEL === 'debug') {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
