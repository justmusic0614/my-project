/**
 * Phase 3 — 驗證 + 去重 + AI 分析（UTC 23:45 = 台北 07:45）
 *
 * 處理流程：
 *   1. 讀取 phase2-result.json
 *   2. Validator: 三層驗證市場數據（Schema + 合理性 + 交叉比對）
 *   3. ImportanceScorer: 規則式 P0-P3 評分
 *   4. NewsDeduplicator: 4-pass 去重
 *   5. AIAnalyzer: Two-Stage（Haiku 分級 → Sonnet 深度分析 + Daily Snapshot）
 *
 * 輸入：data/pipeline-state/phase2-result.json
 * 輸出：data/pipeline-state/phase3-result.json
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const validator      = require('../processors/validator');
const { NewsDeduplicator } = require('../processors/deduplicator');
const importanceScorer     = require('../processors/importance-scorer');
const { AIAnalyzer }       = require('../processors/ai-analyzer');

const logger = createLogger('pipeline:phase3');

const STATE_DIR   = path.join(__dirname, '../data/pipeline-state');
const INPUT_FILE  = path.join(STATE_DIR, 'phase2-result.json');
const OUTPUT_FILE = path.join(STATE_DIR, 'phase3-result.json');

const deduplicator = new NewsDeduplicator();

/**
 * 執行 Phase 3 資料處理
 * @param {object} config
 * @returns {Promise<object>} phase3Result
 */
async function runPhase3(config = {}) {
  logger.info('=== Phase 3: Process & Analyze starting ===');
  const startTime = Date.now();
  costLedger.startRun('phase3');

  _ensureDir(STATE_DIR);

  // 讀取 Phase 2 結果
  const phase2 = _loadPhase2();
  if (!phase2) {
    throw new Error('phase2-result.json not found or invalid');
  }

  // ── Stale Data 保護（防止 OOM 後推播舊日報）────────────────────────────
  // weekend mode：週末不執行 Phase 2，快取最多 48h（週五 23:30 → 週日/週一 00:00）
  // 正常模式：閾值 3h，確保數據當日新鮮
  const isWeekendMode = !!(config && config.weekendMode);
  const PHASE2_STALE_THRESHOLD_MS = isWeekendMode
    ? 48 * 60 * 60 * 1000  // 48 小時
    : 3  * 60 * 60 * 1000; //  3 小時
  const phase2CollectedAt = phase2.collectedAt ? new Date(phase2.collectedAt) : null;
  if (!phase2CollectedAt || (Date.now() - phase2CollectedAt.getTime()) > PHASE2_STALE_THRESHOLD_MS) {
    const ageH = phase2CollectedAt
      ? Math.round((Date.now() - phase2CollectedAt.getTime()) / 3600000)
      : 'unknown';
    const thresholdLabel = isWeekendMode ? '48h' : '3h';
    // 主動推播 Telegram 告警，讓用戶知道日報未推播
    try {
      const TelegramPublisher = require('../publishers/telegram-publisher');
      const { getApiKeys } = require('../shared/api-keys');
      const tg = getApiKeys().getTelegram();
      const pub = new TelegramPublisher({ botToken: tg.botToken, chatId: tg.chatId });
      await pub.publishAlert(
        `⚠️ 今日數據過期（${ageH}h 前收集），日報未推播。\n` +
        `請確認 Phase 2 已正常完成後，手動執行 /today 重試。`
      );
    } catch (alertErr) {
      logger.error(`stale alert send failed: ${alertErr.message}`);
    }
    throw new Error(`phase2 data is stale (${ageH}h old, threshold=${thresholdLabel}). Aborting to prevent outdated report push.`);
  }

  // ── Step 1: 市場數據驗證 ────────────────────────────────────────────────
  logger.info('[Step 1] Validating market data...');
  const collectedData = {
    twse:    phase2.twse    || null,
    fmp:     phase2.phase1Ref?.fmp    || null,
    finmind: phase2.finmind || null,
    yahoo:   phase2.phase1Ref?.yahoo  || null,
    fred:    phase2.phase1Ref?.fred   || null
  };

  const { marketData, validationReport, hasErrors } = validator.validate(collectedData);

  if (hasErrors) {
    logger.warn('validation schema errors detected', validationReport.schemaErrors);
  }
  logger.info('validation complete', {
    degraded:        validationReport.degradedFields.length,
    crossCheckWarns: validationReport.crossCheckWarnings.length
  });

  // ── Step 2: 新聞彙整 ────────────────────────────────────────────────────
  logger.info('[Step 2] Collecting news items...');
  const allNews = _mergeNewsItems(phase2);
  logger.info(`merged ${allNews.length} total news items`);

  // ── Step 3: 重要性評分 ───────────────────────────────────────────────────
  logger.info('[Step 3] Importance scoring...');
  const { scored: scoredNews, geopoliticsTrigger } = importanceScorer.score(allNews);
  logger.info(`scored news: P0=${scoredNews.filter(n=>n.importance==='P0').length} P1=${scoredNews.filter(n=>n.importance==='P1').length}`);

  // ── Step 4: 去重 ─────────────────────────────────────────────────────────
  logger.info('[Step 4] Deduplicating news...');
  const { unique: uniqueNews, report: dedupReport } = deduplicator.deduplicate(scoredNews);
  logger.info(`deduplication: ${dedupReport.total} → ${uniqueNews.length} unique (removed ${dedupReport.removed})`);

  // ── Step 5: AI 分析 ──────────────────────────────────────────────────────
  logger.info('[Step 5] AI analysis (Two-Stage)...');
  const analyzer  = new AIAnalyzer(config.anthropic || {});
  const aiResult  = await analyzer.analyze(uniqueNews, marketData);

  if (aiResult.skipped) {
    logger.warn(`AI analysis skipped: ${aiResult.reason}`);
  } else {
    logger.info('AI analysis complete', {
      marketRegime:    aiResult.marketRegime,
      structuralTheme: aiResult.structuralTheme,
      rankedNews:      aiResult.rankedNews?.length || 0
    });
  }

  // ── 輸出 ─────────────────────────────────────────────────────────────────
  const result = {
    phase:       'phase3',
    date:        phase2.date || _today(),
    processedAt: new Date().toISOString(),
    duration:    Date.now() - startTime,

    // 驗證後市場數據
    marketData,
    validationReport,
    hasErrors,

    // 處理後新聞
    allNewsCount:  allNews.length,
    uniqueNews,
    dedupReport,
    geopoliticsTrigger,

    // AI 分析結果
    aiResult,

    // 附帶原始數據（供 Phase 4 用）
    institutionalData: _extractInstitutional(phase2),
    watchlistPrices:   phase2.finmind?.tw50Prices || {},
    events:            _extractEvents(phase2),
    secFilings:        phase2.phase1Ref?.secEdgar?.filings || [],
    gainersLosers:     _extractGainersLosers(phase2),

    // 市場狀態（透傳到 Phase 4 / Renderer）
    marketContext: phase2.marketContext || config.marketContext || null
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');

  const summary = costLedger.getDailySummary();
  logger.info('=== Phase 3 complete ===', {
    duration: `${Math.round(result.duration / 1000)}s`,
    degraded: validationReport.degradedFields.length,
    uniqueNews: uniqueNews.length,
    aiSkipped: aiResult.skipped,
    cost: `$${summary.totalCost?.toFixed(4) ?? '0.0000'}`
  });

  return result;
}

// ── 資料提取輔助 ────────────────────────────────────────────────────────────

/**
 * 彙整所有來源的新聞
 */
function _mergeNewsItems(phase2) {
  const news = [];

  // RSS 新聞
  if (phase2.rss?.news) {
    news.push(...phase2.rss.news);
  }

  // Perplexity 新聞
  if (phase2.perplexity?.news) {
    news.push(...phase2.perplexity.news);
  }

  // SEC EDGAR 申報（轉換為新聞格式）
  const filings = phase2.phase1Ref?.secEdgar?.filings || [];
  for (const filing of filings) {
    if (filing.importance === 'P0' || filing.importance === 'P1') {
      news.push({
        id:          `sec-${filing.accessionNo || Math.random()}`,
        title:       `[${filing.formType}] ${filing.company}: ${filing.description || '重大申報'}`,
        summary:     filing.description || '',
        source:      'sec-edgar',
        url:         filing.filingUrl || '',
        publishedAt: filing.filedAt   || new Date().toISOString(),
        importance:  filing.importance,
        category:    'SEC_Filing'
      });
    }
  }

  return news;
}

/**
 * 提取法人 + 融資數據
 */
function _extractInstitutional(phase2) {
  const twse    = phase2.twse    || {};
  const finmind = phase2.finmind || {};
  return {
    foreign:       twse.institutional?.foreign ?? finmind.institutional?.foreign,
    trust:         twse.institutional?.trust   ?? finmind.institutional?.trust,
    dealer:        twse.institutional?.dealer  ?? finmind.institutional?.dealer,
    margin:        twse.margin        || null,
    marginTotal:   finmind.marginTotal   || null,
    tw50Prices:    finmind.tw50Prices    || {},
    tw50AllPrices: finmind.tw50AllPrices || {},
    topMovers:     finmind.topMovers     || []
  };
}

/**
 * 提取事件日曆
 */
function _extractEvents(phase2) {
  const events = [];
  const fmp = phase2.phase1Ref?.fmp || {};

  // FMP 財報日曆
  if (Array.isArray(fmp.earningsCalendar)) {
    events.push(...fmp.earningsCalendar.map(e => ({ type: 'earnings', ...e })));
  }

  // FMP 經濟日曆
  if (Array.isArray(fmp.economicCalendar)) {
    events.push(...fmp.economicCalendar.map(e => ({ type: 'economic', ...e })));
  }

  return events;
}

/**
 * 提取漲跌幅排名
 */
function _extractGainersLosers(phase2) {
  const fmp     = phase2.phase1Ref?.fmp || {};
  const finmind = phase2.finmind || {};
  return {
    usGainers: fmp.gainers       || [],
    usLosers:  fmp.losers        || [],
    twGainers: finmind.twGainers || [],
    twLosers:  finmind.twLosers  || []
  };
}

function _loadPhase2() {
  try {
    if (!fs.existsSync(INPUT_FILE)) return null;
    return JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  } catch (err) {
    logger.error(`failed to load phase2-result: ${err.message}`);
    return null;
  }
}

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { runPhase3, OUTPUT_FILE };
