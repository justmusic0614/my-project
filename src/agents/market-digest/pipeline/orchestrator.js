/**
 * Orchestrator — Pipeline 總指揮
 * 負責：
 *   - 按 phase 順序執行 pipeline
 *   - 各 phase 重試機制（最多 3 次）
 *   - Phase 失敗時降級（標記警告，不阻斷後續 phase）
 *   - 整體超時控制
 *   - 推播告警到 Telegram
 *   - SRE: Phase Output Schema 驗證
 *   - SRE: Data Lineage 追蹤
 *   - SRE: Pipeline Metrics 收集
 *
 * 使用方式：
 *   const orchestrator = new Orchestrator(config);
 *   await orchestrator.run('daily');    // 完整 4-phase
 *   await orchestrator.run('phase1');   // 單一 phase
 *   await orchestrator.run('weekend');  // 週末日報
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');
const { getCalendarGuard } = require('../shared/calendar-guard');
const { validate } = require('../shared/schemas/daily-brief.schema');
const { LineageTracker } = require('../sre/lineage-tracker');
const { getManager: getCBManager } = require('../sre/circuit-breaker');

const { runPhase1 } = require('./phase1-us-collect');
const { runPhase2 } = require('./phase2-tw-collect');
const { runPhase3 } = require('./phase3-process');
const { runPhase4 } = require('./phase4-assemble');

const logger = createLogger('pipeline:orchestrator');

const STATE_DIR = path.join(__dirname, '../data/pipeline-state');

// phase 配置（timeout 單位：ms）
const PHASE_CONFIG = {
  phase1: { fn: runPhase1, timeout: 120000, retries: 3, required: false },
  phase2: { fn: runPhase2, timeout: 180000, retries: 3, required: false },
  phase3: { fn: runPhase3, timeout: 120000, retries: 2, required: true  }, // 驗證+AI 必須成功
  phase4: { fn: runPhase4, timeout:  60000, retries: 2, required: true  }  // 推播必須成功
};

class Orchestrator {
  constructor(config = {}) {
    this.config  = config;
    this.results = {};
  }

  /**
   * 執行 Pipeline
   * @param {string} mode - 'daily' | 'phase1' | 'phase2' | 'phase3' | 'phase4' | 'weekend'
   */
  async run(mode = 'daily') {
    logger.info(`=== Orchestrator starting: mode=${mode} ===`);
    const overallStart = Date.now();

    try {
      switch (mode) {
        case 'daily':
          return await this._runDaily();
        case 'phase1':
          return await this._runSinglePhase('phase1');
        case 'phase2':
          return await this._runSinglePhase('phase2');
        case 'phase3':
          return await this._runSinglePhase('phase3');
        case 'phase4':
          return await this._runSinglePhase('phase4');
        case 'weekend':
          return await this._runWeekend();
        default:
          throw new Error(`Unknown mode: ${mode}`);
      }
    } finally {
      const duration = Date.now() - overallStart;
      logger.info(`=== Orchestrator done: ${mode} in ${Math.round(duration / 1000)}s ===`);
    }
  }

  /**
   * 完整 4-phase 日報 pipeline
   */
  async _runDaily() {
    // 查詢市場狀態，注入到 config 供各 phase 使用
    const guard = getCalendarGuard();
    const today = process.env.MARKET_DIGEST_DATE || new Date().toISOString().slice(0, 10);
    const marketContext = guard.getMarketContext(today);
    this.config.marketContext = marketContext;

    logger.info('market context', {
      date: today,
      twse: marketContext.twse.status,
      xnys: marketContext.xnys.status,
      twseReason: marketContext.twse.reason || '-',
      xnysReason: marketContext.xnys.reason || '-'
    });

    const phases = ['phase1', 'phase2', 'phase3', 'phase4'];
    const results = {};
    const overallStart = Date.now();

    // SRE: 初始化 Lineage Tracker
    const lineage = new LineageTracker(today);

    for (const phase of phases) {
      const cfg = PHASE_CONFIG[phase];
      try {
        logger.info(`--- Running ${phase} ---`);
        results[phase] = await this._runWithRetry(phase, cfg);

        // SRE: Phase Output Schema 驗證
        const schemaCheck = validate.phaseOutput(phase, results[phase]);
        if (schemaCheck.abortPipeline) {
          logger.error(`${phase}: ALL critical fields missing, aborting pipeline`);
          results[phase].schemaValidation = schemaCheck;
          break;
        }
        if (schemaCheck.missingCritical?.length > 0) {
          logger.warn(`${phase}: ${schemaCheck.missingCritical.length} critical fields missing: ${schemaCheck.missingCritical.join(', ')}`);
        }
        if (schemaCheck.missingSupplementary?.length > 0) {
          logger.info(`${phase}: ${schemaCheck.missingSupplementary.length} supplementary fields missing: ${schemaCheck.missingSupplementary.join(', ')}`);
        }
        if (schemaCheck.errors.length > 0) {
          logger.warn(`${phase} schema warnings: ${schemaCheck.errors.join('; ')}`);
        }

        // SRE: Lineage 記錄（Phase 1 和 Phase 3 有 marketData）
        if (phase === 'phase1' && results[phase]?.marketData) {
          lineage.recordMarketData('phase1', results[phase].marketData);
        }
        if (phase === 'phase3' && results[phase]?.marketData) {
          lineage.recordMarketData('phase3', results[phase].marketData);
        }

      } catch (err) {
        logger.error(`${phase} failed after retries: ${err.message}`);
        results[phase] = { error: err.message, failed: true };

        if (cfg.required) {
          logger.error(`Required phase ${phase} failed, aborting pipeline`);
          break;
        }
        // 非必要 phase 失敗不阻斷
        logger.warn(`Non-required ${phase} failed, continuing`);
      }
    }

    // SRE: 儲存 Lineage 報告
    let lineageReport = null;
    try {
      lineageReport = lineage.save();
    } catch (err) {
      logger.warn(`lineage save failed: ${err.message}`);
    }

    // SRE: 儲存 Pipeline Metrics
    this._saveMetrics(today, overallStart, results, lineageReport);

    return { mode: 'daily', phases: results, cost: costLedger.getDailySummary(), lineage: lineageReport };
  }

  /**
   * 執行單一 phase
   */
  async _runSinglePhase(phase) {
    const cfg = PHASE_CONFIG[phase];
    if (!cfg) throw new Error(`Unknown phase: ${phase}`);

    const result = await this._runWithRetry(phase, cfg);
    return { mode: phase, result, cost: costLedger.getDailySummary() };
  }

  /**
   * 週末日報（使用快取數據 + Perplexity）
   * 週末不執行完整收集，直接從 phase2 快取讀取，跑 phase3+4
   */
  async _runWeekend() {
    logger.info('Weekend pipeline: running phase3+4 with cached data');
    const results = {};

    // 告知 phase3/4 使用 weekend 模式（豁免 stale check，允許使用 24-48h 舊快取）
    this.config.weekendMode = true;
    try {
      for (const phase of ['phase3', 'phase4']) {
        const cfg = PHASE_CONFIG[phase];
        try {
          results[phase] = await this._runWithRetry(phase, cfg);
        } catch (err) {
          logger.error(`weekend ${phase} failed: ${err.message}`);
          results[phase] = { error: err.message, failed: true };
          if (cfg.required) break;
        }
      }
    } finally {
      this.config.weekendMode = false;
    }

    return { mode: 'weekend', phases: results, cost: costLedger.getDailySummary() };
  }

  /**
   * 帶重試的 phase 執行器
   */
  async _runWithRetry(phase, cfg) {
    const { fn, timeout, retries } = cfg;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // 超時包裝
        const result = await this._withTimeout(
          fn(this.config),
          timeout,
          `${phase} timeout (${timeout}ms)`
        );
        if (attempt > 1) {
          logger.info(`${phase} succeeded on attempt ${attempt}`);
        }
        return result;
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          const delay = Math.min(attempt * 10000, 30000); // 10s, 20s, 30s
          logger.warn(`${phase} attempt ${attempt}/${retries} failed: ${err.message}, retrying in ${delay}ms`);
          await this._sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * SRE: 儲存 Pipeline Metrics JSON
   */
  _saveMetrics(date, overallStart, results, lineageReport) {
    try {
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

      const metrics = {
        date,
        timestamp: new Date().toISOString(),
        totalDuration: Date.now() - overallStart,
        phases: {},
        dataQuality: {
          criticalFieldsMissing: 0,
          supplementaryFieldsMissing: 0,
          degradedFields: 0,
          lineageAnomalies: lineageReport?.anomalyCount || 0
        },
        circuitBreakers: {}
      };

      // Phase 狀態
      for (const [phase, result] of Object.entries(results)) {
        metrics.phases[phase] = {
          status: result?.failed ? 'failed' : 'ok',
          duration: result?.duration || 0,
          errors: Object.keys(result?.errors || {}).length
        };
      }

      // Phase 3 資料品質
      if (results.phase3?.validationReport) {
        metrics.dataQuality.degradedFields = results.phase3.validationReport.degradedFields?.length || 0;
      }
      if (results.phase3?.schemaValidation) {
        metrics.dataQuality.criticalFieldsMissing = results.phase3.schemaValidation.missingCritical?.length || 0;
        metrics.dataQuality.supplementaryFieldsMissing = results.phase3.schemaValidation.missingSupplementary?.length || 0;
      }

      // Circuit Breaker 狀態
      try {
        metrics.circuitBreakers = getCBManager().getStatus();
      } catch { /* CB manager 可能未初始化 */ }

      // 成本
      const cost = costLedger.getDailySummary();
      metrics.cost = cost.totalCost || 0;

      const metricsPath = path.join(STATE_DIR, `metrics-${date}.json`);
      fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');
      logger.info(`metrics saved: ${metricsPath}`);
    } catch (err) {
      logger.warn(`metrics save failed: ${err.message}`);
    }
  }

  _withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Orchestrator;
