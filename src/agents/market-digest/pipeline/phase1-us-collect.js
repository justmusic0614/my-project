/**
 * Phase 1 — 美股收集（UTC 21:30 = 台北 05:30，週一到週五）
 *
 * 收集項目：
 *   FMP:       watchlist 報價 + 財報日曆 + 漲跌幅排名
 *   Yahoo:     ^GSPC ^IXIC ^DJI VIX（fallback）
 *   SEC EDGAR: 最近 24h 重大申報
 *   FMP:       DXY, US10Y, VIX, Economic Calendar
 *
 * 輸出：data/pipeline-state/phase1-result.json
 *
 * 設計原則：
 *   - 所有收集器並行執行（Promise.allSettled）
 *   - 單一收集器失敗不阻塞整體
 *   - 結果寫入 pipeline-state/ 供 phase2 讀取
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger        = require('../shared/cost-ledger');

const FMPCollector      = require('../collectors/fmp-collector');
const YahooCollector    = require('../collectors/yahoo-collector');
const SecEdgarCollector = require('../collectors/sec-edgar-collector');
const { FredCollector } = require('../collectors/fred-collector');
const { MarketHistoryManager } = require('../processors/market-history-manager');

const logger = createLogger('pipeline:phase1');

const STATE_DIR  = path.join(__dirname, '../data/pipeline-state');
const OUTPUT_FILE = path.join(STATE_DIR, 'phase1-result.json');

/**
 * 執行 Phase 1 美股收集
 * @param {object} config - 完整的 config.json 物件
 * @returns {Promise<object>} phase1Result
 */
async function runPhase1(config = {}) {
  logger.info('=== Phase 1: US Market Collection starting ===');
  const startTime = Date.now();
  costLedger.startRun('phase1');

  _ensureDir(STATE_DIR);

  const xnysStatus = config.marketContext?.xnys;

  // 初始化收集器
  const fmp      = new FMPCollector(config);
  const yahoo    = new YahooCollector(config);
  const secEdgar = new SecEdgarCollector(config);
  const fred     = new FredCollector(config.fred || {});
  const historyManager = new MarketHistoryManager();

  let fmpResult, yahooResult, secResult;

  if (xnysStatus && !xnysStatus.isTradingDay) {
    // 美股休市：跳過 FMP 行情 + Yahoo，只收集 SEC
    logger.info(`美股今日休市（${xnysStatus.reason}），跳過 FMP/Yahoo 行情收集`);
    [fmpResult, yahooResult, secResult] = await Promise.allSettled([
      Promise.resolve({ skipped: true, reason: xnysStatus.reason }),
      Promise.resolve({ skipped: true, reason: xnysStatus.reason }),
      _collectSafe(secEdgar, 'sec-edgar')
    ]);
  } else {
    // 正常收集（單一失敗不阻塞）
    [fmpResult, yahooResult, secResult] = await Promise.allSettled([
      _collectSafe(fmp,      'fmp'),
      _collectSafe(yahoo,    'yahoo'),
      _collectSafe(secEdgar, 'sec-edgar')
    ]);
  }

  // ── FRED 資料收集（Fed rate + High-Yield Spread）────────────────────────
  let fredData = {};
  try {
    fredData = await fred.collect(_today());
    logger.info(`FRED collection: ${Object.keys(fredData).length} fields`);
  } catch (err) {
    logger.warn(`FRED collection failed: ${err.message}`);
  }

  // ── 美股情緒資料收集（Put/Call Ratio + SPY Volume）─────────────────────
  let putCallRatio = null;
  let spyVolume = null;
  try {
    [putCallRatio, spyVolume] = await Promise.all([
      fmp.getPutCallRatio(_today()),
      fmp.getSPYVolume(_today())
    ]);
  } catch (err) {
    logger.warn(`sentiment data collection failed: ${err.message}`);
  }

  // ── 組裝 marketData 物件（用於歷史資料管理）────────────────────────────
  const marketData = {
    VIX:             fmpResult.value?.VIX || yahooResult.value?.VIX || null,
    US10Y:           fmpResult.value?.US10Y || yahooResult.value?.US10Y || null,
    DXY:             fmpResult.value?.DXY || yahooResult.value?.DXY || null,
    FED_RATE:        fredData.FED_RATE || null,
    HY_SPREAD:       fredData.HY_SPREAD || null,
    PUT_CALL_RATIO:  putCallRatio,
    SPY_VOLUME:      spyVolume
  };

  // ── 更新歷史資料並計算移動平均 ─────────────────────────────────────────
  let marketHistory = null;
  try {
    marketHistory = await historyManager.updateHistory(_today(), marketData);
    logger.info(`market history updated: ${Object.keys(marketHistory).length} series`);
  } catch (err) {
    logger.warn(`market history update failed: ${err.message}`);
  }

  const result = {
    phase:     'phase1',
    date:      _today(),
    collectedAt: new Date().toISOString(),
    duration:  Date.now() - startTime,
    fmp:       fmpResult.status    === 'fulfilled' ? fmpResult.value    : null,
    yahoo:     yahooResult.status  === 'fulfilled' ? yahooResult.value  : null,
    secEdgar:  secResult.status    === 'fulfilled' ? secResult.value    : null,
    fred:      fredData,
    sentiment: { putCallRatio, spyVolume },
    marketData,
    marketHistory,
    errors:    _collectErrors({ fmpResult, yahooResult, secResult })
  };

  // 寫入 pipeline-state
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');

  const summary = costLedger.getDailySummary();
  logger.info('=== Phase 1 complete ===', {
    duration: `${Math.round(result.duration / 1000)}s`,
    fmp:      result.fmp     ? 'ok' : 'failed',
    yahoo:    result.yahoo   ? 'ok' : 'failed',
    secEdgar: result.secEdgar? 'ok' : 'failed',
    cost:     `$${summary.totalCost?.toFixed(4) ?? '0.0000'}`
  });

  return result;
}

/**
 * 安全收集（捕捉例外）
 */
async function _collectSafe(collector, name) {
  try {
    return await collector.collect();
  } catch (err) {
    logger.error(`${name} collection failed: ${err.message}`);
    throw err; // 讓 allSettled 記錄為 rejected
  }
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

module.exports = { runPhase1, OUTPUT_FILE };
