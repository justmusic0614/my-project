/**
 * Phase 2 — 台股 + RSS + Perplexity 收集（UTC 23:30 = 台北 07:30）
 *
 * 收集項目：
 *   TWSE:       加權指數 + 三大法人 + 融資融券
 *   FinMind:    個股報價 + 法人（交叉比對）
 *   RSS:        4 個 RSS 源新聞（Yahoo TW / CNBC / 經濟日報）
 *   Perplexity: 固定查詢（今日重點 5 件事）+ 動態查詢（基於 Phase1 熱點）
 *               + 地緣政治（條件觸發）
 *   FMP:        Economic Calendar + Earnings Calendar（若 phase1 已收集則跳過）
 *
 * 輸入：data/pipeline-state/phase1-result.json（供 Perplexity 動態查詢用）
 * 輸出：data/pipeline-state/phase2-result.json
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const TWSECollector       = require('../collectors/twse-collector');
const FinMindCollector    = require('../collectors/finmind-collector');
const RSSCollector        = require('../collectors/rss-collector');
const PerplexityCollector = require('../collectors/perplexity-collector');

const logger = createLogger('pipeline:phase2');

const STATE_DIR   = path.join(__dirname, '../data/pipeline-state');
const INPUT_FILE  = path.join(STATE_DIR, 'phase1-result.json');
const OUTPUT_FILE = path.join(STATE_DIR, 'phase2-result.json');

/**
 * 執行 Phase 2 台股 + RSS + Perplexity 收集
 * @param {object} config
 * @returns {Promise<object>} phase2Result
 */
async function runPhase2(config = {}) {
  logger.info('=== Phase 2: TW Market + RSS + Perplexity starting ===');
  const startTime = Date.now();
  costLedger.startRun('phase2');

  _ensureDir(STATE_DIR);

  // 讀取 Phase 1 結果（供 Perplexity 動態查詢）
  let phase1Data = null;
  try {
    if (fs.existsSync(INPUT_FILE)) {
      phase1Data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
      logger.info('phase1-result loaded for context');
    }
  } catch (err) {
    logger.warn(`failed to load phase1-result: ${err.message}`);
  }

  // 初始化收集器
  const rss        = new RSSCollector(config);
  const perplexity = new PerplexityCollector(config);

  const twseStatus = config.marketContext?.twse;
  let twseResult, finmindResult, rssResult, perplexityResult;

  if (twseStatus && !twseStatus.isTradingDay) {
    // 台股休市：跳過 TWSE/FinMind，保留 RSS + Perplexity
    logger.info(`台股今日休市（${twseStatus.reason}），跳過 TWSE/FinMind 收集`);
    [twseResult, finmindResult, rssResult, perplexityResult] = await Promise.allSettled([
      Promise.resolve({ skipped: true, reason: twseStatus.reason }),
      Promise.resolve({ skipped: true, reason: twseStatus.reason }),
      _collectSafe(rss,        'rss'),
      _collectPerplexitySafe(perplexity, phase1Data)
    ]);
  } else {
    const twse    = new TWSECollector(config);
    const finmind = new FinMindCollector(config);
    // 並行收集（所有來源同時啟動）
    [twseResult, finmindResult, rssResult, perplexityResult] = await Promise.allSettled([
      _collectSafe(twse,       'twse'),
      _collectSafe(finmind,    'finmind'),
      _collectSafe(rss,        'rss'),
      // Perplexity 接收 Phase1 context 做動態查詢
      _collectPerplexitySafe(perplexity, phase1Data)
    ]);
  }

  const result = {
    phase:       'phase2',
    date:        _today(),
    collectedAt: new Date().toISOString(),
    duration:    Date.now() - startTime,
    twse:        twseResult.status       === 'fulfilled' ? twseResult.value       : null,
    finmind:     finmindResult.status    === 'fulfilled' ? finmindResult.value    : null,
    rss:         rssResult.status        === 'fulfilled' ? rssResult.value        : null,
    perplexity:  perplexityResult.status === 'fulfilled' ? perplexityResult.value : null,
    // Phase1 數據也附在此，方便 Phase3 一次讀取
    phase1Ref: {
      fmp:      phase1Data?.fmp      || null,
      yahoo:    phase1Data?.yahoo    || null,
      secEdgar: phase1Data?.secEdgar || null
    },
    // 市場狀態（供 Phase3/4 透傳）
    marketContext: config.marketContext || null,
    errors: _collectErrors({ twseResult, finmindResult, rssResult, perplexityResult })
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');

  const summary = costLedger.getDailySummary();
  logger.info('=== Phase 2 complete ===', {
    duration:   `${Math.round(result.duration / 1000)}s`,
    twse:       result.twse      ? 'ok' : 'failed',
    finmind:    result.finmind   ? 'ok' : 'failed',
    rss:        result.rss       ? `ok(${(result.rss.news || []).length} items)` : 'failed',
    perplexity: result.perplexity? `ok(${(result.perplexity.news || []).length} items)` : 'failed',
    cost:       `$${summary.totalCost?.toFixed(4) ?? '0.0000'}`
  });

  return result;
}

async function _collectSafe(collector, name) {
  try {
    return await collector.collect();
  } catch (err) {
    logger.error(`${name} collection failed: ${err.message}`);
    throw err;
  }
}

async function _collectPerplexitySafe(perplexity, phase1Data) {
  try {
    // 從 Phase1 新聞提取 P0/P1 頭條作為動態查詢 context
    const phase1Context = _buildPerplexityContext(phase1Data);
    return await perplexity.collect(phase1Context);
  } catch (err) {
    logger.error(`perplexity collection failed: ${err.message}`);
    throw err;
  }
}

/**
 * 從 Phase1 結果提取重要新聞頭條，作為 Perplexity 動態查詢的 context
 */
function _buildPerplexityContext(phase1Data) {
  if (!phase1Data) return null;

  const secFilings = phase1Data.secEdgar?.filings || [];
  const p0Filings  = secFilings.filter(f => f.importance === 'P0').slice(0, 3);

  return {
    date: phase1Data.date,
    secHighlights: p0Filings.map(f => `[${f.formType}] ${f.company}`),
    marketSummary: phase1Data.fmp ? {
      sp500ChangePct:  phase1Data.fmp.SP500?.changePct,
      nasdaqChangePct: phase1Data.fmp.NASDAQ?.changePct,
      vix:             phase1Data.fmp.VIX?.value
    } : null
  };
}

function _collectErrors(results) {
  const errors = {};
  for (const [key, result] of Object.entries(results)) {
    if (result.status === 'rejected') {
      errors[key.replace('Result', '')] = result.reason?.message || 'unknown';
    }
  }
  return errors;
}

function _ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { runPhase2, OUTPUT_FILE };
