/**
 * SundayTacticalPipeline — 週日戰術報告 Pipeline
 *
 * 流程：
 *   a. SPY/RSP/QQQ 歷史填充 SQLite
 *   b. Watchlist 9 檔 60d cache
 *   c. fetchVIX3M
 *   d. 讀最新 daily-brief（週五）
 *   e. 從 SQLite 讀取歷史
 *   f-j. 計算（Breadth/KeyLevels/Phase/Trigger/Contradiction）
 *   k. AI 分析
 *   l. 渲染
 *   m. Telegram 推播 + 存檔
 *
 * fail-soft 原則：任何 fetch 失敗不阻斷報告產出
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../shared/logger');
const { safeWriteJson, safeWriteText } = require('../shared/safe-write');
const { safeReadJsonOrNull } = require('../shared/safe-read');

const logger = createLogger('pipeline:sunday-tactical');

class SundayTacticalPipeline {
  constructor(config = {}) {
    this.config = config;
    this.baseDir = path.join(__dirname, '..');
    this.dryRun = config.dryRun || false;
  }

  async run() {
    logger.info('Sunday Tactical Pipeline started');
    const startTime = Date.now();
    const degradedFlags = [];

    // ── 模組載入 ────────────────────────────────────────────────────
    const YahooCollector = require('../collectors/yahoo-collector');
    const { MarketHistoryManager } = require('../processors/market-history-manager');
    const { BreadthCalculator } = require('../analyzers/breadth-calculator');
    const { KeyLevelsEngine } = require('../analyzers/key-levels-engine');
    const { PhaseEngine } = require('../analyzers/phase-engine');
    const triggerEngine = require('../analyzers/trigger-engine');
    const contradictionDetector = require('../shared/contradiction-detector');
    const aiAnalyzer = require('../processors/ai-analyzer');
    const { TacticalRenderer } = require('../renderers/tactical-renderer');

    const yahoo = new YahooCollector(this.config);
    const mgr = new MarketHistoryManager();
    const breadthCalc = new BreadthCalculator();
    const keyLevelsEngine = new KeyLevelsEngine();
    const phaseEngine = new PhaseEngine();
    const renderer = new TacticalRenderer();

    try {
      // ── a. SPY/RSP/QQQ 歷史填充 SQLite ─────────────────────────────
      logger.info('Step a: Filling SPY/RSP/QQQ history into SQLite');
      await this._fillEtfHistory(yahoo, mgr, degradedFlags);

      // ── b. Watchlist 9 檔 60d cache ────────────────────────────────
      logger.info('Step b: Updating watchlist close cache');
      const watchlistCache = await this._updateWatchlistCache(yahoo, degradedFlags);

      // ── c. VIX3M ──────────────────────────────────────────────────
      logger.info('Step c: Fetching VIX3M');
      const vix3m = await yahoo.fetchVIX3M();
      if (vix3m == null) degradedFlags.push('vix3m_unavailable');

      // ── d. 讀最新 daily-brief（週五）──────────────────────────────
      logger.info('Step d: Reading latest daily-brief');
      const dailyBrief = this._findLatestDailyBrief();
      const timestamps = this._extractTimestamps(dailyBrief);

      // ── e. 從 SQLite 讀取歷史 ─────────────────────────────────────
      logger.info('Step e: Reading history from SQLite');
      const spxHistory = mgr.getHistory('sp500', 250);
      const spyHistory = mgr.getHistory('spy', 400);
      const rspHistory = mgr.getHistory('rsp', 400);
      const taiexHistory = mgr.getHistory('taiex', 250);
      const qqqHistory = mgr.getHistory('qqq', 250);

      // ── f. Breadth（fail-soft）────────────────────────────────────
      logger.info('Step f: Calculating breadth');
      let breadth = breadthCalc.calculatePrimary(spyHistory, rspHistory);
      if (breadth.mode === 'NONE') {
        logger.warn('Primary breadth unavailable, falling back to secondary');
        breadth = breadthCalc.calculateSecondary(watchlistCache);
        if (breadth.mode === 'NONE') {
          degradedFlags.push('breadth_unavailable');
        }
      }

      // ── g. Key Levels ─────────────────────────────────────────────
      logger.info('Step g: Calculating key levels');
      const keyLevels = keyLevelsEngine.calculate(spxHistory, taiexHistory);

      // ── h. Phase Engine（只讀 state，不寫入）──────────────────────
      logger.info('Step h: Running Phase Engine');
      const statePath = path.join(this.baseDir, 'data/pipeline-state/phase-engine-state.json');
      let phaseState = phaseEngine.loadState(statePath);
      if (!phaseState) {
        phaseState = phaseEngine.initStateFromHistory(spxHistory);
      }

      // 組裝 indicators
      const spxCloses = spxHistory.map(r => r.close);
      const spxMAs = MarketHistoryManager.getMovingAverages(spxCloses);
      const qqqCloses = qqqHistory.map(r => r.close);
      const qqqMAs = MarketHistoryManager.getMovingAverages(qqqCloses);

      // 從 daily-brief 取 VIX/DXY/US10Y/hySpread
      const vixValue = dailyBrief?.VIX?.value || null;
      const dxyValue = dailyBrief?.DXY?.value || null;
      const us10yValue = dailyBrief?.US10Y?.value || null;
      const hySpreadValue = dailyBrief?.HY_SPREAD?.value || null;

      // hySpread 5d change（從 JSON 序列）
      const hySpreadSeries = mgr.getSeriesHistory('hy-spread');
      let hySpread5dChange = null;
      if (hySpreadSeries.length >= 6) {
        hySpread5dChange = hySpreadSeries[hySpreadSeries.length - 1].value -
          hySpreadSeries[hySpreadSeries.length - 6].value;
      }

      const today = new Date().toISOString().slice(0, 10);
      const indicators = {
        spxClose: spxCloses[spxCloses.length - 1] || null,
        spxMa20: spxMAs.ma20,
        spxMa50: spxMAs.ma50,
        spxMa200: spxMAs.ma200,
        qqqClose: qqqCloses[qqqCloses.length - 1] || null,
        qqqMa50: qqqMAs.ma50,
        vix: vixValue,
        dxy: dxyValue,
        us10y: us10yValue,
        hySpread: hySpreadValue,
        hySpread5dChange,
        breadthState: breadth.state,
        breadthMode: breadth.mode,
        asOf: today
      };

      // SPX 20d high/5d change（for contradiction detector）
      if (spxCloses.length >= 20) {
        indicators.spx20dHigh = Math.max(...spxCloses.slice(-20));
        if (spxCloses.length >= 6) {
          indicators.spx5dChange = spxCloses[spxCloses.length - 1] - spxCloses[spxCloses.length - 6];
        }
      }
      // DXY 5d change
      const dxySeries = mgr.getSeriesHistory('dxy');
      if (dxySeries.length >= 6) {
        indicators.dxy5dChange = dxySeries[dxySeries.length - 1].value - dxySeries[dxySeries.length - 6].value;
      }
      // Gold
      const goldHistory = mgr.getHistory('gold', 20);
      if (goldHistory.length > 0) {
        indicators.goldClose = goldHistory[goldHistory.length - 1].close;
        indicators.gold20dHigh = Math.max(...goldHistory.map(r => r.close));
      }

      const phaseResult = phaseEngine.evaluate(indicators, phaseState);

      // ── i. Triggers ───────────────────────────────────────────────
      logger.info('Step i: Evaluating triggers');
      const triggers = triggerEngine.evaluate(indicators, phaseState);

      // ── j. Contradictions ─────────────────────────────────────────
      logger.info('Step j: Detecting contradictions');
      const contradictions = contradictionDetector.detect(indicators);

      // ── k. AI 分析 ────────────────────────────────────────────────
      logger.info('Step k: AI tactical analysis');
      const weeklyContext = {
        keyLevels, triggers, contradictions, breadth,
        vix3m, hySpread5dChange, degradedFlags
      };
      const aiTactical = await aiAnalyzer.analyzeSundayTactical(phaseResult, weeklyContext);

      // ── l. 渲染 ──────────────────────────────────────────────────
      logger.info('Step l: Rendering tactical report');

      // Put/Call Ratio（嘗試從 TWSE 取得）
      let putCallRatio = null;
      try {
        const TWSECollector = require('../collectors/twse-collector');
        const twse = new TWSECollector(this.config);
        putCallRatio = await twse.fetchPutCallRatio();
      } catch (err) {
        logger.warn(`Put/Call ratio fetch failed: ${err.message}`);
      }

      const weekLabel = this._currentWeekLabel();
      const report = renderer.render({
        phaseResult,
        phaseState: phaseResult.newState || phaseState,
        keyLevels,
        triggers,
        contradictions,
        breadth,
        aiTactical,
        timestamps,
        weekLabel,
        vix3m,
        putCallRatio
      });

      // ── m. 存檔 + 推播 ───────────────────────────────────────────
      const reportDir = path.join(this.baseDir, 'data/weekly-report');
      const reportFile = path.join(reportDir, `tactical-${weekLabel}.txt`);
      safeWriteText(reportFile, report);
      logger.info(`Report saved: ${reportFile}`);

      // Telegram 推播
      if (!this.dryRun) {
        try {
          const { sendTelegram } = require('../shared/telegram');
          await sendTelegram(report);
          logger.info('Telegram sent');
        } catch (err) {
          logger.error(`Telegram send failed: ${err.message}`);
        }
      } else {
        logger.info('Dry-run mode: skipping Telegram');
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Sunday Tactical Pipeline completed in ${elapsed}s`, {
        phase: phaseResult.phase,
        triggers: triggers.length,
        contradictions: contradictions.length,
        degradedFlags
      });

      return { report, phaseResult, degradedFlags };

    } finally {
      mgr.closeDb();
    }
  }

  // ── 私有方法 ────────────────────────────────────────────────────────

  async _fillEtfHistory(yahoo, mgr, degradedFlags) {
    const etfs = [
      { symbol: 'SPY', column: 'spy' },
      { symbol: 'RSP', column: 'rsp' },
      { symbol: 'QQQ', column: 'qqq' }
    ];

    for (const { symbol, column } of etfs) {
      try {
        // 判斷需要多少天
        const existing = mgr.getHistory(column, 252);
        const days = existing.length >= 252 ? 260 : 400;

        logger.info(`Fetching ${symbol} (${days}d) for ${column}`);
        const data = await yahoo.fetchHistoricalPrices(symbol, days);
        const stats = mgr.batchInsertColumn(column, data);
        logger.info(`${symbol}: inserted=${stats.inserted}, updated=${stats.updated}`);
      } catch (err) {
        logger.warn(`${symbol} fetch failed: ${err.message}`);
        degradedFlags.push(`${column}_fetch_failed`);
      }
    }
  }

  async _updateWatchlistCache(yahoo, degradedFlags) {
    const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO'];
    const cachePath = path.join(this.baseDir, 'data/market-history/watchlist-close.json');

    // 讀取現有 cache
    let cache = safeReadJsonOrNull(cachePath) || {};
    const quality = cache._quality || {};

    for (const symbol of WATCHLIST) {
      try {
        logger.info(`Fetching watchlist: ${symbol}`);
        const bars = await yahoo.fetchHistoricalPrices(symbol, 60);

        // Merge（同日 skip）+ 保留 80 筆
        const existing = Array.isArray(cache[symbol]) ? cache[symbol] : [];
        const existingDates = new Set(existing.map(b => b.date));
        const newBars = bars
          .filter(b => !existingDates.has(b.date))
          .map(b => ({ date: b.date, close: b.close }));

        let merged = [...existing, ...newBars].sort((a, b) => a.date.localeCompare(b.date));
        if (merged.length > 80) merged = merged.slice(-80);

        cache[symbol] = merged;
        quality[symbol] = { ok: true, fetchedAt: new Date().toISOString() };
      } catch (err) {
        logger.warn(`Watchlist ${symbol} failed: ${err.message}`);
        quality[symbol] = { fetch_failed: true, fetchedAt: new Date().toISOString() };
      }
    }

    cache._quality = quality;
    safeWriteJson(cachePath, cache);

    const failCount = Object.values(quality).filter(q => q.fetch_failed).length;
    if (failCount >= 3) degradedFlags.push(`watchlist_${failCount}_failed`);

    return cache;
  }

  _findLatestDailyBrief() {
    // 在 data/runtime/ 尋找最新的 daily-brief JSON
    const runtimeDir = path.join(this.baseDir, 'data/runtime');
    if (!fs.existsSync(runtimeDir)) return null;

    const files = fs.readdirSync(runtimeDir)
      .filter(f => f.startsWith('daily-brief') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    try {
      const content = fs.readFileSync(path.join(runtimeDir, files[0]), 'utf8');
      return JSON.parse(content);
    } catch (err) {
      logger.warn(`Failed to read daily-brief: ${err.message}`);
      return null;
    }
  }

  _extractTimestamps(dailyBrief) {
    if (!dailyBrief) return {};
    return {
      usDataAsOf: dailyBrief.us?.fetchedAt || dailyBrief.fetchedAt || null,
      twDataAsOf: dailyBrief.tw?.fetchedAt || null,
      fxCryptoAsOf: dailyBrief.yahoo?.fetchedAt || dailyBrief.fetchedAt || null
    };
  }

  _currentWeekLabel() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((now - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
}

module.exports = { SundayTacticalPipeline };
