/**
 * PhaseEngine — Market Phase 引擎
 *
 * 7 種市場狀態：
 *   CRISIS → RISK_OFF_STRESS → RISK_OFF_CORRECTION → CHOPPY_NEUTRAL
 *   → RISK_ON_EARLY → RISK_ON_MATURE → RISK_ON_LATE → (cycle)
 *   UNKNOWN（資料不足）
 *
 * 核心規則：
 * - evaluate(indicators, state) 是 **完全 deterministic 純函數**
 *   禁止 Date.now()、fs、DB、任何 I/O（可做回測/simulation/replay）
 * - loadState / saveState 由外部（phase3-process.js）控制
 */

'use strict';

const { createLogger } = require('../shared/logger');
const { safeReadJsonOrNull } = require('../shared/safe-read');
const { safeWriteJson } = require('../shared/safe-write');
const SchemaValidator = require('../shared/schema-validator');

const logger = createLogger('analyzer:phase-engine');
const validator = new SchemaValidator({ logger });

const SCHEMA_VERSION = 1;

const PHASES = [
  'CRISIS', 'RISK_OFF_STRESS', 'RISK_OFF_CORRECTION',
  'CHOPPY_NEUTRAL', 'RISK_ON_EARLY', 'RISK_ON_MATURE', 'RISK_ON_LATE',
  'UNKNOWN'
];

class PhaseEngine {
  /**
   * 評估目前市場 Phase（純函數，完全 deterministic）
   *
   * @param {object} indicators - 當日市場指標
   *   { spxClose, spxMa20, spxMa50, spxMa200, qqqMa50,
   *     vix, dxy, us10y, hySpread, hySpread5dChange,
   *     breadthState, breadthMode, asOf }
   * @param {object} state - 上一次持久化的 state（或 {}）
   * @returns {{ phase, confidence, scores, indicators, asOf, degraded,
   *             newState, transitions }}
   */
  evaluate(indicators, state = {}) {
    // ── 硬下限檢查 ──
    if (!indicators || indicators.spxClose == null || indicators.spxMa50 == null) {
      return this._degradedResult(indicators, state, 'Missing critical indicators (spxClose or spxMa50)');
    }

    const ind = indicators;
    const scores = {};
    let degraded = false;
    const degradedReasons = [];

    // ══════════════════════════════════════════════════════════════════════
    //  Hard Gates（絕對條件，直接決定 phase 下限/上限）
    // ══════════════════════════════════════════════════════════════════════

    // CRISIS gate：VIX > 35 連續 2 天
    const crisisStreak = (ind.vix > 35)
      ? (state.crisisStreak || 0) + 1
      : 0;

    // STRESS gate：VIX > 28 連續 2 天
    const stressStreak = (ind.vix > 28)
      ? (state.stressStreak || 0) + 1
      : 0;

    // CORRECTION gate：SPX < MA50 連續 1 天
    const spxBelowMa50 = ind.spxClose < ind.spxMa50;
    const spxBelowMa50Days = spxBelowMa50
      ? (state.spxBelowMa50Days || 0) + 1
      : 0;

    // VIX > 22 streak
    const vixAbove22Days = (ind.vix > 22)
      ? (state.vixAbove22Days || 0) + 1
      : 0;

    // CORRECTION → CHOPPY exit tracking
    const correctionStreak = spxBelowMa50
      ? (state.correctionStreak || 0) + 1
      : 0;
    const correctionExitDays = (!spxBelowMa50 && (state.correctionStreak || 0) > 0)
      ? (state.correctionExitDays || 0) + 1
      : spxBelowMa50 ? 0 : (state.correctionExitDays || 0);

    // ══════════════════════════════════════════════════════════════════════
    //  Score 計算
    // ══════════════════════════════════════════════════════════════════════

    // Trend score（-100 ~ +100）
    const trendScore = this._calcTrendScore(ind);
    scores.trend = trendScore;

    // Volatility score（0 ~ 100, 高=風險高）
    const volScore = this._calcVolScore(ind);
    scores.volatility = volScore;

    // Credit score（0 ~ 100, 高=風險高）
    const creditScore = this._calcCreditScore(ind);
    scores.credit = creditScore;

    // Breadth score（0 ~ 100）
    const breadthScore = this._calcBreadthScore(ind);
    scores.breadth = breadthScore;
    if (breadthScore == null) {
      degradedReasons.push('breadth unavailable');
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Phase 決策（Hard Gate 優先，Score 輔助）
    // ══════════════════════════════════════════════════════════════════════

    let phase;

    if (crisisStreak >= 2) {
      phase = 'CRISIS';
    } else if (stressStreak >= 2) {
      phase = 'RISK_OFF_STRESS';
    } else if (spxBelowMa50Days >= 1 && ind.vix > 20) {
      phase = 'RISK_OFF_CORRECTION';
    } else if (spxBelowMa50Days >= 1) {
      // SPX < MA50 但 VIX 不高 → CHOPPY
      phase = 'CHOPPY_NEUTRAL';
    } else {
      // SPX ≥ MA50 → RISK_ON 系列
      phase = this._classifyRiskOn(ind, state, scores);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Hysteresis（防抖動）
    // ══════════════════════════════════════════════════════════════════════

    const prevPhase = state.currentPhase || 'UNKNOWN';
    const phaseDays = (phase === prevPhase) ? (state.phaseDays || 0) + 1 : 1;

    // Phase 變動需至少 1 天確認（CRISIS 除外）
    if (phase !== prevPhase && phase !== 'CRISIS' && phaseDays < 1) {
      phase = prevPhase;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Confidence
    // ══════════════════════════════════════════════════════════════════════

    let confidence = 'HIGH';
    if (degradedReasons.length > 0) confidence = 'MEDIUM';
    if (phaseDays <= 2) confidence = 'MEDIUM';
    if (phase === 'UNKNOWN') confidence = 'LOW';
    if (degradedReasons.includes('breadth unavailable')) confidence = 'LOW';

    // ══════════════════════════════════════════════════════════════════════
    //  New State（供 saveState 持久化）
    // ══════════════════════════════════════════════════════════════════════

    const newState = {
      schemaVersion: SCHEMA_VERSION,
      currentPhase: phase,
      previousPhase: prevPhase,
      phaseDays,
      crisisStreak,
      stressStreak,
      correctionStreak,
      correctionExitDays,
      vixAbove22Days,
      spxBelowMa50Days,
      ma50_crossed_above_date: this._updateMa50CrossDate(ind, state),
      lastUpdated: ind.asOf || null
    };

    // Transitions
    const transitions = [];
    if (phase !== prevPhase) {
      transitions.push({ from: prevPhase, to: phase, day: ind.asOf });
    }

    degraded = degraded || degradedReasons.length > 0;

    return {
      phase,
      confidence,
      scores,
      indicators: {
        spxClose: ind.spxClose,
        spxMa50: ind.spxMa50,
        spxMa200: ind.spxMa200,
        vix: ind.vix,
        breadthState: ind.breadthState,
        hySpread: ind.hySpread
      },
      asOf: ind.asOf || null,
      degraded,
      degradedReasons,
      newState,
      transitions
    };
  }

  // ── Score 計算（純函數）──────────────────────────────────────────────

  _calcTrendScore(ind) {
    let score = 0;
    // SPX vs MA50
    if (ind.spxClose != null && ind.spxMa50 != null) {
      const pctAboveMa50 = ((ind.spxClose - ind.spxMa50) / ind.spxMa50) * 100;
      score += Math.max(-40, Math.min(40, pctAboveMa50 * 8));
    }
    // SPX vs MA200
    if (ind.spxClose != null && ind.spxMa200 != null) {
      const pctAboveMa200 = ((ind.spxClose - ind.spxMa200) / ind.spxMa200) * 100;
      score += Math.max(-30, Math.min(30, pctAboveMa200 * 3));
    }
    // QQQ vs MA50
    if (ind.qqqClose != null && ind.qqqMa50 != null) {
      const pctAbove = ((ind.qqqClose - ind.qqqMa50) / ind.qqqMa50) * 100;
      score += Math.max(-30, Math.min(30, pctAbove * 6));
    }
    return Math.max(-100, Math.min(100, Math.round(score)));
  }

  _calcVolScore(ind) {
    if (ind.vix == null) return 30; // 無 VIX → 中性偏低
    // VIX 12→0, 20→40, 30→70, 40→90, 50→100
    return Math.round(Math.min(100, Math.max(0, (ind.vix - 12) * 2.6)));
  }

  _calcCreditScore(ind) {
    let score = 0;
    if (ind.hySpread != null) {
      // HY spread 3→0, 4→25, 5→50, 6→75, 8→100
      score += Math.min(100, Math.max(0, (ind.hySpread - 3) * 20));
    }
    if (ind.hySpread5dChange != null) {
      // 5d change: +0.3→+30 risk
      score += Math.min(50, Math.max(-20, ind.hySpread5dChange * 100));
    }
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  _calcBreadthScore(ind) {
    const stateMap = { BROAD: 90, HEALTHY: 70, MIXED: 50, NARROW: 30, BROKEN: 10 };
    return stateMap[ind.breadthState] || null;
  }

  // ── RISK_ON 子分類 ───────────────────────────────────────────────────

  _classifyRiskOn(ind, state, scores) {
    // EARLY：MA50 向上穿越不久（< 20 天）
    const crossDate = state.ma50_crossed_above_date || null;
    const asOf = ind.asOf;
    let daysSinceCross = null;

    if (crossDate && asOf) {
      daysSinceCross = Math.floor(
        (new Date(asOf).getTime() - new Date(crossDate).getTime()) / 86400000
      );
    }

    if (daysSinceCross != null && daysSinceCross <= 20) {
      return 'RISK_ON_EARLY';
    }

    // LATE：trend 高但 breadth 差，或 vol 升高
    if (scores.trend > 50 && (scores.breadth != null && scores.breadth <= 30)) {
      return 'RISK_ON_LATE';
    }
    if (scores.trend > 30 && scores.volatility > 50) {
      return 'RISK_ON_LATE';
    }

    // MATURE：正常 risk-on
    return 'RISK_ON_MATURE';
  }

  // ── MA50 cross date 追蹤 ────────────────────────────────────────────

  _updateMa50CrossDate(ind, state) {
    const prev = state.ma50_crossed_above_date || null;
    // 如果昨天 SPX < MA50 但今天 SPX ≥ MA50 → 記錄今天
    if (state.spxBelowMa50Days > 0 && ind.spxClose >= ind.spxMa50) {
      return ind.asOf || prev;
    }
    return prev;
  }

  // ── degraded result ─────────────────────────────────────────────────

  _degradedResult(indicators, state, reason) {
    return {
      phase: 'UNKNOWN',
      confidence: 'LOW',
      scores: {},
      indicators: indicators || {},
      asOf: indicators?.asOf || null,
      degraded: true,
      degradedReasons: [reason],
      newState: {
        schemaVersion: SCHEMA_VERSION,
        currentPhase: 'UNKNOWN',
        previousPhase: state.currentPhase || 'UNKNOWN',
        phaseDays: 1,
        crisisStreak: 0,
        stressStreak: 0,
        correctionStreak: 0,
        correctionExitDays: 0,
        vixAbove22Days: 0,
        spxBelowMa50Days: 0,
        ma50_crossed_above_date: state.ma50_crossed_above_date || null,
        lastUpdated: indicators?.asOf || null
      },
      transitions: []
    };
  }

  // ── State I/O（由外部呼叫，不在 evaluate 內）──────────────────────────

  /**
   * 讀取持久化 state（含 schema 驗證）
   * @param {string} filePath - phase-engine-state.json 路徑
   * @returns {object|null} state 或 null（不存在/版本不符/驗證失敗）
   */
  loadState(filePath) {
    const data = safeReadJsonOrNull(filePath);
    if (!data) return null;

    // schemaVersion 檢查
    if (data.schemaVersion !== SCHEMA_VERSION) {
      logger.warn(`Phase Engine state version mismatch: expected ${SCHEMA_VERSION}, got ${data.schemaVersion}. Re-initializing.`);
      return null;
    }

    // Schema 驗證
    const validated = SchemaValidator.safeValidateOrCorrupt(
      data,
      (d) => validator.validatePhaseEngineState(d),
      filePath,
      logger
    );

    return validated;
  }

  /**
   * 儲存持久化 state
   * @param {string} filePath - phase-engine-state.json 路徑
   * @param {object} state - newState from evaluate()
   */
  saveState(filePath, state) {
    // 寫入前驗證（失敗 → throw，不 rename）
    const result = validator.validatePhaseEngineState(state);
    if (!result.valid) {
      throw new Error(`Phase Engine state validation failed: ${JSON.stringify(result.errors)}`);
    }
    safeWriteJson(filePath, state);
    logger.info(`Phase Engine state saved: phase=${state.currentPhase}, days=${state.phaseDays}`);
  }

  /**
   * 從歷史資料初始化 state（首次或 state 遺失時）
   * @param {Array<{date:string, close:number}>} spxHistory - SP500 升冪
   * @returns {object} 初始 state
   */
  initStateFromHistory(spxHistory) {
    if (!spxHistory || spxHistory.length < 60) {
      logger.warn(`initStateFromHistory: insufficient data (${spxHistory?.length || 0} bars, need 60)`);
      return {
        schemaVersion: SCHEMA_VERSION,
        currentPhase: 'UNKNOWN',
        previousPhase: 'UNKNOWN',
        phaseDays: 1,
        crisisStreak: 0,
        stressStreak: 0,
        correctionStreak: 0,
        correctionExitDays: 0,
        vixAbove22Days: 0,
        spxBelowMa50Days: 0,
        ma50_crossed_above_date: null,
        lastUpdated: null
      };
    }

    // 計算 MA50 序列，找最近一次向上穿越
    const closes = spxHistory.map(r => r.close);
    let crossDate = null;

    for (let i = 50; i < closes.length; i++) {
      const ma50 = closes.slice(i - 50, i).reduce((a, b) => a + b, 0) / 50;
      const prevMa50 = closes.slice(i - 51, i - 1).reduce((a, b) => a + b, 0) / 50;
      if (closes[i - 1] < prevMa50 && closes[i] >= ma50) {
        crossDate = spxHistory[i].date;
      }
    }

    logger.info(`initStateFromHistory: ma50_crossed_above_date=${crossDate}`);

    return {
      schemaVersion: SCHEMA_VERSION,
      currentPhase: 'UNKNOWN',
      previousPhase: 'UNKNOWN',
      phaseDays: 1,
      crisisStreak: 0,
      stressStreak: 0,
      correctionStreak: 0,
      correctionExitDays: 0,
      vixAbove22Days: 0,
      spxBelowMa50Days: 0,
      ma50_crossed_above_date: crossDate,
      lastUpdated: spxHistory[spxHistory.length - 1].date
    };
  }
}

module.exports = { PhaseEngine };
