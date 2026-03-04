#!/usr/bin/env node
/**
 * social-digest Agent — CLI 入口（M2, 更新至 Phase 1 完整 pipeline）
 *
 * 用法：
 *   node agent.js run                    # 正常執行（IMAP + Email）
 *   node agent.js run --dry-run          # 不寄信，產出 latest.html preview
 *   node agent.js run --backfill-hours 24  # 擴大 internalDate 視窗補漏
 *   node agent.js status                 # 顯示上次 run 狀態
 *   node agent.js db-stats               # 顯示資料庫統計
 *   node agent.js help                   # 顯示說明
 *
 * Pipeline：
 *   Step 1:  IMAP 收信
 *   Step 1b: Web Collection（HN, RSS, GitHub）
 *   Step 2:  Email 解析 + 去重（含 web posts 合併）
 *   Step 2b: AI Summarizer（M13 — batch AI → upsertAiResult, fail-open）
 *   Step 3:  取未送出貼文（LEFT JOIN ai_results）
 *   Step 4:  Rule Filter
 *   Step 5:  Post Scorer（calibrated_score 整合 AI）
 *   Step 6-8: Shortcode + Snapshot + Email Publisher
 *   → 更新水位線 + Kill Switch 檢查
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

// ── Logger ────────────────────────────────────────────────────────────────────

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

// ── 生成 run_id（D1: makeRunId 唯一生成點）─────────────────────────────────────

const { makeRunId } = require('./src/shared/contracts');

/** @deprecated — 保留給 legacy run record 比對，新 run 一律用 makeRunId() */
function newRunId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const rand = crypto.randomBytes(3).toString('hex');
  return `run-${ts}-${rand}`;
}

/**
 * 讀取 kill-switch.json runtime flags
 * @returns {{ ai_enabled: boolean, triggered_at: string|null, reason: string|null, cooldown_until: string|null }}
 */
function loadKillSwitch() {
  const ksPath = path.join(AGENT_ROOT, 'data/runtime/kill-switch.json');
  if (!fs.existsSync(ksPath)) {
    return { ai_enabled: true, triggered_at: null, reason: null, cooldown_until: null };
  }
  try {
    return JSON.parse(fs.readFileSync(ksPath, 'utf8'));
  } catch {
    return { ai_enabled: true, triggered_at: null, reason: null, cooldown_until: null };
  }
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

function loadRules() {
  return JSON.parse(fs.readFileSync(path.join(AGENT_ROOT, 'data/rules.json'), 'utf8'));
}

// ── run 主流程 ─────────────────────────────────────────────────────────────────

async function run(args) {
  const dryRun = args.includes('--dry-run');
  const backfillIdx = args.indexOf('--backfill-hours');
  const backfillHours = backfillIdx >= 0 ? parseInt(args[backfillIdx + 1], 10) || 24 : null;

  const runId = makeRunId();  // D1: Asia/Taipei YYYYMMDD 唯一生成點
  log('info', `開始 run ${runId}`, { dryRun, backfillHours: backfillHours ?? 'none' });

  // ── 載入模組 ─────────────────────────────────────────────────────────────
  const { getDB } = require('./src/shared/db');
  const { SourceManager } = require('./src/shared/source-manager');
  const { parseEmails } = require('./src/processors/email-parser');
  const { dedup } = require('./src/processors/deduplicator');
  const { applyRules, buildSourceMap } = require('./src/processors/rule-filter');
  const { scorePosts, assignSections } = require('./src/processors/post-scorer');
  const { summarizeAll } = require('./src/processors/ai-summarizer');
  const { buildDigestEmail, buildRunSnapshot, sendDigest, calcShortcode } = require('./src/publishers/email-publisher');
  const alerter = require('./src/shared/alerter');
  const imapCollector = require('./src/collectors/imap-collector');
  const { createClient: createHttpClient } = require('./src/collectors/http-client');
  const hnCollector = require('./src/collectors/hn-collector');
  const rssCollector = require('./src/collectors/rss-collector');
  const githubCollector = require('./src/collectors/github-collector');

  const db = getDB(AGENT_ROOT, config.db?.path);
  const sm = new SourceManager(path.join(AGENT_ROOT, 'data/sources.json'));
  const rules = loadRules();
  const prev = loadLatest();

  db.startRun(runId);

  // 初始化 HTTP client（web collectors 共用）
  if (config.http) {
    createHttpClient(config.http);
  }

  // Kill Switch 檢查
  const killSwitch = loadKillSwitch();
  const aiConfigEnabled = config.ai?.enabled !== 'false' && config.ai?.enabled !== false;
  const aiEnabled = aiConfigEnabled && killSwitch.ai_enabled;

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
    template_fp_stats: null,
    ai_tokens_in: 0,
    ai_tokens_out: 0,
    ai_flags: {
      ai_enabled_effective: aiEnabled,
      ai_batches_attempted: 0,
      ai_batches_succeeded: 0,
      kill_switch_active: !killSwitch.ai_enabled,
    },
    rules_version: rules.version || null,
    errors: [],
    collector_stats: {},
  };

  const allAlerts = [];
  let newWatermark = null;
  const webWatermarkUpdates = {};
  let feedCacheUpdates = {};
  const disabledUpdates = {};
  const recoveredKeys = [];

  try {
    // ── Step 1：IMAP 收信（M4）───────────────────────────────────────────────
    log('info', 'Step 1: IMAP 收信');
    let emails = [];

    // 檢查 IMAP 必要設定
    if (!config.imap.user || !config.imap.password) {
      log('warn', 'IMAP 未設定帳密（GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD），跳過收信');
      stats.errors.push({ code: 'IMAP_NO_CREDENTIALS', error: '未設定 IMAP 帳密' });
    } else {
      try {
        const collectResult = await imapCollector.collect(
          config.imap,
          prev,
          backfillHours || 24
        );
        emails = collectResult.emails;
        newWatermark = collectResult.newWatermark;
        log('info', 'IMAP 收信完成', {
          fetched: collectResult.stats.fetched,
          deduped: collectResult.stats.deduped,
          mailbox: collectResult.stats.mailbox,
        });
      } catch (imapErr) {
        log('error', `IMAP 收信失敗：${imapErr.message}`);
        stats.errors.push({ code: 'IMAP_ERROR', error: imapErr.message });
      }
    }

    stats.mail_count = emails.length;

    // 收信告警
    const collectAlerts = alerter.checkCollect(emails.length);
    allAlerts.push(...collectAlerts);
    alerter.printAlerts(collectAlerts, (level, msg) => log(level.toLowerCase(), msg));

    // ── Step 1b：Web Collection ────────────────────────────────────────────
    log('info', 'Step 1b: Web Collection');
    let webPosts = [];
    const prevDisabled = prev.disabled_sources || {};
    const prevWatermarks = prev.web_watermarks || {};

    // 收集所有啟用的 web collectors
    const webCollectors = [];

    // HN Collector
    if (config.collectors?.hackernews?.enabled) {
      const hnSources = sm.getEnabledByType('hackernews');
      if (hnSources.length > 0) {
        webCollectors.push({
          name: hnCollector.COLLECTOR_TYPE,
          fn: () => hnCollector.collect(hnSources, config.collectors.hackernews, prevWatermarks, prevDisabled),
        });
      }
    }

    // RSS Collector
    if (config.collectors?.rss?.enabled) {
      const rssSources = sm.getEnabledByType('rss');
      if (rssSources.length > 0) {
        webCollectors.push({
          name: rssCollector.COLLECTOR_TYPE,
          fn: () => rssCollector.collect(rssSources, config.collectors.rss, prevWatermarks, prevDisabled, prev.feed_cache || {}),
        });
      }
    }

    // GitHub Releases Collector
    if (config.collectors?.github_releases?.enabled) {
      const ghSources = sm.getEnabledByType('github_releases');
      if (ghSources.length > 0) {
        webCollectors.push({
          name: githubCollector.COLLECTOR_TYPE_RELEASES,
          fn: () => githubCollector.collectReleases(ghSources, config.collectors.github_releases, prevWatermarks, prevDisabled),
        });
      }
    }

    // 並行執行所有 web collectors
    if (webCollectors.length > 0) {
      const results = await Promise.allSettled(
        webCollectors.map(c => c.fn())
      );

      for (let i = 0; i < results.length; i++) {
        const collectorName = webCollectors[i].name;
        const result = results[i];

        if (result.status === 'fulfilled') {
          const cr = result.value;
          webPosts.push(...cr.posts);

          // 合併 watermark（key-level，只更新成功的 key）
          Object.assign(webWatermarkUpdates, cr.watermark);

          // 合併 feedCacheUpdates（僅 rss collector 有此欄位）
          if (cr.feedCacheUpdates) {
            Object.assign(feedCacheUpdates, cr.feedCacheUpdates);
          }

          // 合併 disabled
          for (const d of (cr.disabled || [])) {
            disabledUpdates[d.source_key] = {
              until: d.until,
              reason: d.reason,
              since: prevDisabled[d.source_key]?.since || new Date().toISOString(),
              consecutive: d.consecutive,
            };
          }

          // 合併 recovered
          recoveredKeys.push(...(cr.recovered || []));

          // collector stats
          stats.collector_stats[collectorName] = cr.stats;

          log('info', `[${collectorName}] 完成`, {
            ok: cr.stats.ok,
            fetched: cr.stats.fetched,
            parsed: cr.stats.parsed,
            filtered: cr.stats.filtered,
            posts: cr.posts.length,
            skipped_disabled: cr.stats.skipped_disabled,
            duration_ms: cr.stats.duration_ms,
          });
        } else {
          log('error', `[${collectorName}] collector crash: ${result.reason?.message || result.reason}`);
          stats.collector_stats[collectorName] = {
            ok: false,
            fetched: 0,
            parsed: 0,
            filtered: 0,
            new: 0,
            errors: [{ code: 'COLLECTOR_CRASH', error: result.reason?.message || String(result.reason) }],
            duration_ms: 0,
          };
          stats.errors.push({
            code: 'WEB_COLLECTOR_ERROR',
            collector: collectorName,
            error: result.reason?.message || String(result.reason),
          });
        }
      }

      log('info', 'Web Collection 完成', { total_web_posts: webPosts.length });
    }

    // ── Step 2：Email 解析（M6）+ 去重（M7）────────────────────────────────
    log('info', 'Step 2: Email 解析 + 去重');
    let newPosts = [];

    if (emails.length > 0) {
      const parseResult = parseEmails(emails);
      stats.email_parse_ok_rate = parseResult.stats.email_parse_ok_rate;
      stats.post_extract_ok_rate = parseResult.stats.post_extract_ok_rate;
      stats.high_conf_rate = parseResult.stats.high_conf_rate;
      stats.template_fp_stats = parseResult.stats.template_fp_stats;

      // 解析品質告警
      const parseAlerts = alerter.checkParseQuality(
        { ...parseResult.stats, template_fp_stats: parseResult.stats.template_fp_stats },
        prev,
        rules.alerts
      );
      allAlerts.push(...parseAlerts);
      alerter.printAlerts(parseAlerts, (level, msg) => log(level.toLowerCase(), msg));

      // 去重並插入新貼文
      const dedupResult = dedup(db, parseResult.posts);
      newPosts = dedupResult.newPosts;
      stats.new_post_count = newPosts.length;

      log('info', '解析完成', {
        emails: emails.length,
        parsed_posts: parseResult.posts.length,
        new_posts: newPosts.length,
        dup_skipped: dedupResult.stats.input - dedupResult.stats.new,
      });
    }

    // Web posts 去重（走同一 dedup pipeline）
    if (webPosts.length > 0) {
      const webDedupResult = dedup(db, webPosts);
      const webNewCount = webDedupResult.newPosts.length;
      stats.new_post_count += webNewCount;
      newPosts.push(...webDedupResult.newPosts);

      log('info', 'Web posts 去重完成', {
        input: webPosts.length,
        new: webNewCount,
        dup_skipped: webPosts.length - webNewCount,
      });
    }

    // ── Step 2b：AI Summarizer（M13）── fail-open ─────────────────────────
    if (aiEnabled) {
      log('info', 'Step 2b: AI Summarizer');
      try {
        const aiResult = await summarizeAll(db, config);
        stats.ai_tokens_in = aiResult.stats.ai_tokens_in || 0;
        stats.ai_tokens_out = aiResult.stats.ai_tokens_out || 0;
        stats.ai_flags = {
          ...stats.ai_flags,
          ai_batches_attempted: aiResult.stats.ai_batches_attempted || 0,
          ai_batches_succeeded: aiResult.stats.ai_batches_succeeded || 0,
          ai_coverage: aiResult.stats.ai_coverage || 0,
          ai_call_cap_hit: aiResult.stats.ai_call_cap_hit || false,
          ai_budget_halted: aiResult.stats.ai_budget_halted || false,
        };
        log('info', 'AI Summarizer 完成', {
          processed: aiResult.totalProcessed,
          tokens_in: stats.ai_tokens_in,
          tokens_out: stats.ai_tokens_out,
        });
      } catch (aiErr) {
        // fail-open：AI 失敗不中斷 pipeline
        log('warn', `AI Summarizer 失敗（fail-open）：${aiErr.message}`);
        stats.errors.push({ code: 'AI_ERROR', error: aiErr.message });
        stats.ai_flags.ai_error = aiErr.message;
      }
    } else {
      log('info', 'Step 2b: AI Summarizer 已停用', {
        config_enabled: aiConfigEnabled,
        kill_switch: !killSwitch.ai_enabled,
      });
    }

    // ── Step 3：取未送出貼文（從 DB）──────────────────────────────────────
    log('info', 'Step 3: 取未送出貼文');
    const unsentPosts = db.getUnsentPosts(500);
    stats.post_count = unsentPosts.length;
    log('info', `未送出貼文：${unsentPosts.length} 篇`);

    if (unsentPosts.length === 0) {
      log('info', '無未送出貼文，跳過後續步驟');
    } else {
      // ── Step 4：Rule Filter（M8）────────────────────────────────────────
      log('info', 'Step 4: Rule Filter');
      const sourceMap = buildSourceMap(sm.getEnabled());
      const filteredPosts = applyRules(unsentPosts, rules, sourceMap);

      const mustCount = filteredPosts.filter(p => p.rule_section === 'must_include').length;
      const muteCount = filteredPosts.filter(p => p.mute_keyword_hit).length;
      log('info', 'Rule Filter 完成', { must_include: mustCount, muted: muteCount });

      // ── Step 5：Post Scorer（M10）────────────────────────────────────────
      log('info', 'Step 5: Post Scorer');
      const topicSigCounts = db.getRecentTopicSignatures(rules.novelty?.topic_signature_window_hours || 24);
      const sourceSigCounts = db.getRecentSourceSignatures(rules.novelty?.source_signature_window_days || 7);

      const scoredPosts = scorePosts(filteredPosts, rules, sourceMap, topicSigCounts, sourceSigCounts);
      const rankedPosts = assignSections(scoredPosts, rules);

      const topPicks = rankedPosts.filter(p => p.section === 'top_picks');
      const everythingElse = rankedPosts.filter(p => p.section === 'everything_else');
      const overflow = rankedPosts.filter(p => p.section === 'overflow');
      stats.top_picks_count = topPicks.length;
      stats.sent_count = topPicks.length + everythingElse.length;

      log('info', '排序完成', {
        top_picks: topPicks.length,
        everything_else: everythingElse.length,
        overflow: overflow.length,
      });

      // ── Step 6：Shortcode 加工（M9.5 前置）──────────────────────────────
      const rankedWithSc = rankedPosts.map(p => ({
        ...p,
        shortcode: calcShortcode(p.id),
      }));

      // ── Step 7：決策快照（M9.5）──────────────────────────────────────────
      const quotaBreakdown = {
        must_include: rankedWithSc.filter(p => p.rule_section === 'must_include' && p.section === 'top_picks').length,
        ai: rankedWithSc.filter(p => p.section === 'top_picks' && p.importance_score != null).length,
        rule: rankedWithSc.filter(p => p.section === 'top_picks' && p.importance_score == null && p.rule_section !== 'must_include').length,
      };
      const snapshot = buildRunSnapshot(runId, rankedWithSc, quotaBreakdown);
      const snapshotPath = path.join(runtimePath, `run-${runId}.json`);
      fs.mkdirSync(runtimePath, { recursive: true });
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
      log('debug', `決策快照已儲存：${snapshotPath}`);

      // ── Step 8：Email Publisher（M9）─────────────────────────────────────
      log('info', 'Step 8: Email Publisher');
      const digestConfig = {
        topPicksMax: rules.top_picks_max || 20,
        everythingElseMax: rules.everything_else_max || 60,
        subjectPrefix: config.digest?.subjectPrefix || '[SocialDigest]',
        topPicksCapPerSource: config.digest?.topPicksCapPerSource ?? 3,
      };
      const runStatsForEmail = {
        run_id: runId,
        email_parse_ok_rate: stats.email_parse_ok_rate,
        post_extract_ok_rate: stats.post_extract_ok_rate,
        high_conf_rate: stats.high_conf_rate,
        l2_success_rate: stats.l2_success_rate,
      };
      const trackingConfig = config.tracking || null;
      const { subject, html, text } = buildDigestEmail(rankedWithSc, digestConfig, runStatsForEmail, trackingConfig);

      // 儲存 latest.html（dry-run 也存）
      const latestHtmlPath = path.join(runtimePath, 'latest.html');
      fs.writeFileSync(latestHtmlPath, html, 'utf8');
      log('info', `latest.html 已儲存：${latestHtmlPath}`);

      if (!dryRun) {
        // 發信（含重試一次）
        let sendResult = await sendDigest(config.smtp, subject, html, text, false);

        if (!sendResult.ok) {
          log('warn', `首次發信失敗，重試中：${sendResult.error}`);
          sendResult = await sendDigest(config.smtp, subject, html, text, false);

          if (!sendResult.ok) {
            const smtpAlert = alerter.checkSmtpFailed(sendResult.error, true);
            allAlerts.push(smtpAlert);
            alerter.printAlerts([smtpAlert], (level, msg) => log(level.toLowerCase(), msg));
            stats.errors.push({ code: 'SMTP_FAILED', error: sendResult.error });
          }
        }

        if (sendResult.ok) {
          log('info', '發信成功', { messageId: sendResult.messageId || '-' });
          // 標記已送出
          const sentIds = rankedWithSc
            .filter(p => p.section !== 'overflow')
            .map(p => p.id);
          db.markSent(sentIds);
        }
      } else {
        log('info', '[dry-run] 不寄信，latest.html 已產出');
      }
    }

  } catch (err) {
    log('error', `Pipeline 執行失敗：${err.message}`);
    stats.errors.push({ code: 'PIPELINE_ERROR', error: err.message });
    if (process.env.LOG_LEVEL === 'debug') {
      process.stderr.write(err.stack + '\n');
    }
  }

  // ── 完成：更新 latest.json + finishRun ──────────────────────────────────
  const ended = new Date().toISOString();
  stats.ended_at = ended;

  db.finishRun(runId, {
    ...stats,
    ai_tokens_in: stats.ai_tokens_in || 0,
    ai_tokens_out: stats.ai_tokens_out || 0,
    ai_flags: stats.ai_flags || null,
    errors: stats.errors.length > 0 ? stats.errors : null,
    template_fp_stats: stats.template_fp_stats || null,
  });

  // web_watermarks: key-level merge（只更新成功的 key，保留其餘）
  const mergedWatermarks = { ...(prev.web_watermarks || {}), ...webWatermarkUpdates };

  // disabled_sources: 合併 disabled + 清除 recovered + 清理過期
  const mergedDisabled = { ...(prev.disabled_sources || {}), ...disabledUpdates };
  for (const key of recoveredKeys) {
    delete mergedDisabled[key];
  }
  // 清理過期的 disabled entries
  const now = new Date();
  for (const [key, entry] of Object.entries(mergedDisabled)) {
    if (new Date(entry.until) <= now) {
      delete mergedDisabled[key];
    }
  }

  // Health Score log（cron 可視性）
  const healthLines = Object.entries(stats.collector_stats || {}).map(([type, s]) => {
    if (!s) return `  ${type}: DISABLED`;
    const disabledCount = Object.keys(mergedDisabled).filter(k => k.startsWith(type + ':')).length;
    return `  ${type}: ${s.ok ? 'OK' : 'FAIL'} (fetched=${s.fetched} new=${s.new} disabled=${disabledCount})`;
  });
  if (healthLines.length > 0) {
    log('info', `Health Score:\n${healthLines.join('\n')}`);
  }

  const nextLatest = {
    // 水位線三件套：只有 IMAP 成功回傳 newWatermark 才更新，否則保持上次值
    imap_last_uid: newWatermark?.imap_last_uid ?? prev.imap_last_uid ?? null,
    imap_last_internal_date: newWatermark?.imap_last_internal_date ?? prev.imap_last_internal_date ?? null,
    imap_last_message_id: newWatermark?.imap_last_message_id ?? prev.imap_last_message_id ?? null,
    // 執行狀態
    last_run_id: runId,
    last_run_at: ended,
    last_run_status: stats.errors.length > 0 ? 'error' : 'ok',
    mail_count: stats.mail_count,
    post_count: stats.post_count,
    new_post_count: stats.new_post_count,
    sent_count: stats.sent_count,
    email_parse_ok_rate: stats.email_parse_ok_rate,
    post_extract_ok_rate: stats.post_extract_ok_rate,
    high_conf_rate: stats.high_conf_rate,
    l2_success_rate: stats.l2_success_rate,
    // Web collector 狀態
    web_watermarks: mergedWatermarks,
    collector_stats: stats.collector_stats,
    disabled_sources: mergedDisabled,
    // feed_cache：只允許 rss:* keys（defensive filter）
    // 304 Not Modified：不覆蓋原本 ETag（feedCacheUpdates 不含該 key）
    feed_cache: {
      ...(prev.feed_cache || {}),
      ...Object.fromEntries(
        Object.entries(feedCacheUpdates).filter(([k]) => k.startsWith('rss:'))
      ),
    },
  };
  saveLatest(nextLatest);

  // 全部告警 summary
  if (allAlerts.length > 0) {
    log('warn', `本次 run 共 ${allAlerts.length} 個告警（ERROR: ${allAlerts.filter(a => a.level === 'ERROR').length}，WARN: ${allAlerts.filter(a => a.level === 'WARN').length}）`);
  }

  log('info', dryRun ? '[dry-run] 完成' : 'run 完成', {
    run_id: runId,
    new_posts: stats.new_post_count,
    sent: stats.sent_count,
    top_picks: stats.top_picks_count,
  });

  return { ok: stats.errors.length === 0, run_id: runId, stats, alerts: allAlerts };
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
    'Pipeline（Phase 1）：',
    '  IMAP 收信 → Email 解析 → 去重 → Rule Filter → Post Scorer → Email Publisher',
    '  （IMAP 連線 TODO：M4 骨架已就緒，等待 imapflow 實作）',
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
    '',
    'VPS Cron 設定（每日台灣時間 07:00 = UTC 23:00）：',
    '  0 23 * * * XDG_RUNTIME_DIR=/run/user/$(id -u) cd ~/clawd/agents/social-digest && /home/clawbot/.nvm/versions/node/v22.22.0/bin/node agent.js run >> logs/cron.log 2>&1',
    '  （加入前先 mkdir -p ~/clawd/agents/social-digest/logs）',
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
