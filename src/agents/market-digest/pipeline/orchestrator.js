/**
 * Orchestrator — Pipeline 總指揮
 * 負責：
 *   - 按 phase 順序執行 pipeline
 *   - 各 phase 重試機制（最多 3 次）
 *   - Phase 失敗時降級（標記警告，不阻斷後續 phase）
 *   - 整體超時控制
 *   - 推播告警到 Telegram
 *
 * 使用方式：
 *   const orchestrator = new Orchestrator(config);
 *   await orchestrator.run('daily');    // 完整 4-phase
 *   await orchestrator.run('phase1');   // 單一 phase
 *   await orchestrator.run('weekend');  // 週末日報
 */

'use strict';

const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const { runPhase1 } = require('./phase1-us-collect');
const { runPhase2 } = require('./phase2-tw-collect');
const { runPhase3 } = require('./phase3-process');
const { runPhase4 } = require('./phase4-assemble');

const logger = createLogger('pipeline:orchestrator');

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
    const phases = ['phase1', 'phase2', 'phase3', 'phase4'];
    const results = {};

    for (const phase of phases) {
      const cfg = PHASE_CONFIG[phase];
      try {
        logger.info(`--- Running ${phase} ---`);
        results[phase] = await this._runWithRetry(phase, cfg);
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

    return { mode: 'daily', phases: results, cost: costLedger.getDailySummary() };
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
