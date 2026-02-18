/**
 * Phase 4 — 組裝 + 推播（UTC 00:00 = 台北 08:00）
 *
 * 流程：
 *   1. 讀取 phase3-result.json
 *   2. 讀取 watchlist.json
 *   3. DailyRenderer: 組裝 Daily Brief 文字
 *   4. TelegramPublisher: 推播到 Telegram
 *   5. ArchivePublisher: 本地存檔 + Git commit
 *   6. AlertPublisher: 推播 pipeline 成功通知
 *   7. 成本記錄
 *
 * 極端降級：所有 API 失敗時推播簡短告警訊息
 *
 * 輸入：data/pipeline-state/phase3-result.json
 * 輸出：data/daily-brief/YYYY-MM-DD.{json,txt}
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const { DailyRenderer }   = require('../renderers/daily-renderer');
const TelegramPublisher   = require('../publishers/telegram-publisher');
const ArchivePublisher    = require('../publishers/archive-publisher');
const AlertPublisher      = require('../publishers/alert-publisher');

const logger = createLogger('pipeline:phase4');

const STATE_DIR  = path.join(__dirname, '../data/pipeline-state');
const INPUT_FILE = path.join(STATE_DIR, 'phase3-result.json');
const DATA_DIR   = path.join(__dirname, '../data');

/**
 * 執行 Phase 4 組裝推播
 * @param {object} config
 * @returns {Promise<object>} result
 */
async function runPhase4(config = {}) {
  logger.info('=== Phase 4: Assemble & Publish starting ===');
  const startTime = Date.now();
  costLedger.startRun('phase4');

  // 讀取 Phase 3 結果
  const phase3 = _loadPhase3();
  if (!phase3) {
    throw new Error('phase3-result.json not found or invalid');
  }

  const date    = phase3.date || _today();
  const telegramConfig = config.telegram || {};

  // 初始化推播器
  const telegram = new TelegramPublisher({
    botToken:          telegramConfig.botToken,
    chatId:            telegramConfig.chatId,
    dryRun:            config.dryRun || false,
    maxMessageLength:  telegramConfig.maxMessageLength || 4000
  });

  const archiver = new ArchivePublisher({
    basePath:   DATA_DIR,
    dailyPath:  path.join(DATA_DIR, 'daily-brief'),
    weeklyPath: path.join(DATA_DIR, 'weekly-report'),
    gitEnabled: config.archive?.gitEnabled !== false
  });

  const alerter = new AlertPublisher(telegram, {
    cooldownMs: 30 * 60 * 1000
  });

  // ── 極端降級偵測 ──────────────────────────────────────────────────────────
  const isFullyDegraded = _isFullyDegraded(phase3);
  if (isFullyDegraded) {
    logger.error('CRITICAL: all data sources failed, sending degradation alert');
    await alerter.criticalNoData(date);
    const result = { phase: 'phase4', date, status: 'critical-degraded', duration: Date.now() - startTime };
    _saveResult(result);
    return result;
  }

  // ── Step 1: 讀取 watchlist ────────────────────────────────────────────────
  const watchlist = _loadWatchlist(config.paths?.watchlist);

  // ── Step 2: 組裝 Daily Brief ──────────────────────────────────────────────
  logger.info('[Step 1] Rendering Daily Brief...');
  const renderer = new DailyRenderer();
  const briefData = {
    date,
    marketData:       phase3.marketData       || {},
    aiResult:         phase3.aiResult         || {},
    rankedNews:       phase3.aiResult?.rankedNews || phase3.uniqueNews || [],
    watchlist,
    events:           phase3.events           || [],
    secFilings:       phase3.secFilings        || [],
    institutionalData: phase3.institutionalData || {},
    gainersLosers:    phase3.gainersLosers     || {}
  };

  const briefText = renderer.render(briefData);
  logger.info(`brief rendered: ${briefText.length} chars`);

  // ── Step 3: 推播到 Telegram ───────────────────────────────────────────────
  logger.info('[Step 2] Publishing to Telegram...');
  let telegramResult = { sent: 0, failed: 0 };
  try {
    telegramResult = await telegram.publishDailyBrief(briefText);
  } catch (err) {
    logger.error(`telegram publish failed: ${err.message}`);
    await alerter.pipelineFailed('phase4-telegram', err);
  }

  // ── Step 4: 本地存檔 ──────────────────────────────────────────────────────
  logger.info('[Step 3] Archiving...');
  let archiveResult = {};
  try {
    archiveResult = archiver.archiveDailyBrief(date, briefText, phase3);
    // Git commit（每日一次）
    archiver.gitCommit(`market-digest: daily brief ${date}`);
  } catch (err) {
    logger.warn(`archive failed: ${err.message}`);
  }

  // ── Step 5: 告警檢查 ──────────────────────────────────────────────────────
  // 降級欄位告警
  const degradedFields = phase3.validationReport?.degradedFields || [];
  await alerter.degradationAlert(degradedFields, 7); // 7 個以上才告警

  // 交叉比對告警
  const crossCheckWarns = phase3.validationReport?.crossCheckWarnings || [];
  await alerter.crossCheckAlert(crossCheckWarns);

  // 成本告警
  const dailyCost = costLedger.getDailySummary();
  if (dailyCost.totalCost > 0) {
    const budget = dailyCost.dailyBudgetUsd || 2.0;
    if (dailyCost.totalCost / budget > 0.8) {
      await alerter.budgetAlert({ totalCost: dailyCost.totalCost, budget });
    }
  }

  // ── Step 6: Pipeline 成功通知 ─────────────────────────────────────────────
  const duration = Date.now() - startTime;
  await alerter.pipelineSuccess({
    date,
    duration,
    cost:     dailyCost.totalCost,
    degraded: degradedFields.length
  });

  const result = {
    phase:    'phase4',
    date,
    status:   telegramResult.failed === 0 ? 'ok' : 'partial',
    duration,
    telegram: telegramResult,
    archive:  { jsonPath: archiveResult.jsonPath, txtPath: archiveResult.txtPath },
    briefLength: briefText.length,
    cost:        dailyCost.totalCost
  };

  _saveResult(result);

  logger.info('=== Phase 4 complete ===', {
    duration:      `${Math.round(duration / 1000)}s`,
    telegram_sent: telegramResult.sent,
    cost:          `$${dailyCost.totalCost?.toFixed(4) ?? '0.0000'}`
  });

  return result;
}

// ── 輔助函式 ───────────────────────────────────────────────────────────────

function _isFullyDegraded(phase3) {
  const md = phase3.marketData || {};
  const keyFields = ['TAIEX', 'SP500', 'NASDAQ'];
  return keyFields.every(f => md[f]?.degraded === 'NA');
}

function _loadWatchlist(watchlistPath) {
  const p = watchlistPath || path.join(DATA_DIR, 'watchlist.json');
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(data) ? data : (data.watchlist || []);
    }
  } catch {}
  return [];
}

function _loadPhase3() {
  try {
    if (!fs.existsSync(INPUT_FILE)) return null;
    return JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  } catch (err) {
    logger.error(`failed to load phase3-result: ${err.message}`);
    return null;
  }
}

function _saveResult(result) {
  try {
    const dir = path.join(STATE_DIR);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'phase4-result.json'), JSON.stringify(result, null, 2), 'utf8');
  } catch {}
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { runPhase4, INPUT_FILE };
