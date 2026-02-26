/**
 * TacticalRenderer — Weekly Tactical Setup 渲染器
 *
 * 格式：
 *   === Weekly Tactical Setup YYYY-WXX ===
 *   Market Phase / 下週主軸 / 關鍵位 / 觸發條件 / Cross-Asset / Playbook
 *
 * SSOT：主段顯示 state.currentPhase + state.phaseDays（週五 phase3 的 SSOT）
 * 資料日期標籤：三段來源在 render() 入參明確傳入，renderer 不自行推算
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('renderer:tactical');

const PHASE_LABELS = {
  CRISIS:              '危機模式',
  RISK_OFF_STRESS:     '風險趨避（壓力）',
  RISK_OFF_CORRECTION: '風險趨避（修正）',
  CHOPPY_NEUTRAL:      '震盪中性',
  RISK_ON_EARLY:       '風險偏好（初期）',
  RISK_ON_MATURE:      '風險偏好（成熟）',
  RISK_ON_LATE:        '風險偏好（晚期）',
  UNKNOWN:             '未知（資料不足）'
};

class TacticalRenderer {
  /**
   * @param {object} params
   * @param {object} params.phaseResult - PhaseEngine.evaluate() 結果
   * @param {object} params.phaseState - 持久化 state（含 currentPhase, phaseDays）
   * @param {object} params.keyLevels - KeyLevelsEngine.calculate() 結果
   * @param {Array}  params.triggers - TriggerEngine.evaluate() 結果
   * @param {Array}  params.contradictions - ContradictionDetector.detect() 結果
   * @param {object} params.breadth - BreadthCalculator 結果
   * @param {object} params.aiTactical - AI analyzeSundayTactical() 結果
   * @param {object} params.timestamps - { usDataAsOf, twDataAsOf, fxCryptoAsOf }
   * @param {string} params.weekLabel - "YYYY-WXX"
   * @param {number|null} params.vix3m - VIX3M 值
   * @param {object|null} params.putCallRatio - { value, asOf }
   * @returns {string}
   */
  render(params = {}) {
    const {
      phaseResult = {},
      phaseState = {},
      keyLevels = {},
      triggers = [],
      contradictions = [],
      breadth = {},
      aiTactical = {},
      timestamps = {},
      weekLabel = '',
      vix3m = null,
      putCallRatio = null
    } = params;

    const lines = [];

    // ── Header ────────────────────────────────────────────────────────
    lines.push(`=== Weekly Tactical Setup ${weekLabel} ===`);
    lines.push('');

    // ── 1. Market Phase ──────────────────────────────────────────────
    const phase = phaseState.currentPhase || phaseResult.phase || 'UNKNOWN';
    const phaseDays = phaseState.phaseDays || 1;
    const phaseLabel = PHASE_LABELS[phase] || phase;
    const confidence = phaseResult.confidence || 'LOW';

    lines.push('📊 Market Phase');
    lines.push(`  ${phase} — ${phaseLabel}（連續 ${phaseDays} 日）`);
    lines.push(`  信心度: ${confidence}`);

    if (phaseResult.degraded) {
      const reasons = phaseResult.degradedReasons?.join(', ') || '資料不足';
      lines.push(`  ⚠️ ${reasons}`);
    }

    // Scores
    if (phaseResult.scores && Object.keys(phaseResult.scores).length > 0) {
      const s = phaseResult.scores;
      const parts = [];
      if (s.trend != null) parts.push(`Trend=${s.trend}`);
      if (s.volatility != null) parts.push(`Vol=${s.volatility}`);
      if (s.credit != null) parts.push(`Credit=${s.credit}`);
      if (s.breadth != null) parts.push(`Breadth=${s.breadth}`);
      if (parts.length > 0) lines.push(`  Scores: ${parts.join(' | ')}`);
    }
    lines.push('');

    // ── 2. 下週主軸 ─────────────────────────────────────────────────
    if (aiTactical.mainThesis) {
      lines.push('🎯 下週主軸');
      lines.push(`  ${aiTactical.mainThesis}`);
      lines.push('');
    }

    // ── 3. 關鍵位階 ─────────────────────────────────────────────────
    lines.push('📍 關鍵位階');
    this._renderKeyLevels(lines, keyLevels);
    lines.push('');

    // ── 4. 觸發條件 ─────────────────────────────────────────────────
    if (triggers.length > 0) {
      lines.push('⚡ 觸發條件（如果 A → 則 B）');
      for (const t of triggers) {
        lines.push(`  [${t.impact}] ${t.detail}`);
        lines.push(`    → ${t.action}`);
      }
      lines.push('');
    }

    // ── 5. 矛盾訊號 ─────────────────────────────────────────────────
    if (contradictions.length > 0) {
      lines.push('⚠️ 矛盾訊號');
      for (const c of contradictions) {
        lines.push(`  • ${c.description}`);
        lines.push(`    ${c.implication}`);
      }
      lines.push('');
    }

    // ── 6. Cross-Asset ──────────────────────────────────────────────
    lines.push('🌐 Cross-Asset');
    this._renderCrossAsset(lines, phaseResult, breadth, vix3m, putCallRatio);
    if (aiTactical.crossAssetNarrative) {
      lines.push(`  ${aiTactical.crossAssetNarrative}`);
    }
    lines.push('');

    // ── 7. Playbook ─────────────────────────────────────────────────
    if (aiTactical.playbook) {
      lines.push('📋 Playbook');
      const items = Array.isArray(aiTactical.playbook)
        ? aiTactical.playbook
        : aiTactical.playbook.split('\n').filter(Boolean);
      for (const item of items) {
        const line = item.replace(/^[-•*]\s*/, '').trim();
        if (line) lines.push(`  • ${line}`);
      }
      lines.push('');
    }

    // ── 8. 資料日期 ─────────────────────────────────────────────────
    lines.push('📅 Data Sources');
    if (timestamps.usDataAsOf) lines.push(`  US data as of: ${timestamps.usDataAsOf}`);
    if (timestamps.twDataAsOf) lines.push(`  TW data as of: ${timestamps.twDataAsOf}`);
    if (timestamps.fxCryptoAsOf) lines.push(`  FX/Crypto as of: ${timestamps.fxCryptoAsOf}`);
    lines.push('');

    // Footer
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('免責聲明：本報告僅供資訊參考，不構成投資建議');

    const text = lines.join('\n');
    logger.info(`tactical report rendered: ${lines.length} lines`);
    return text;
  }

  _renderKeyLevels(lines, keyLevels) {
    // SPX
    const spx = keyLevels.spx;
    if (spx) {
      lines.push(`  [SPX] Current: ${spx.current?.toFixed(0)}`);
      if (spx.support?.length > 0) {
        const supports = spx.support.map(s => `${s.label}=${s.value.toFixed(0)}`).join(', ');
        lines.push(`    Support: ${supports}`);
      }
      if (spx.resistance?.length > 0) {
        const resists = spx.resistance.map(s => `${s.label}=${s.value.toFixed(0)}`).join(', ');
        lines.push(`    Resistance: ${resists}`);
      }
    } else {
      lines.push('  [SPX] 資料不足');
    }

    // TAIEX
    const taiex = keyLevels.taiex;
    if (taiex) {
      lines.push(`  [TAIEX] Current: ${taiex.current?.toFixed(0)}`);
      if (taiex.support?.length > 0) {
        const supports = taiex.support.map(s => `${s.label}=${s.value.toFixed(0)}`).join(', ');
        lines.push(`    Support: ${supports}`);
      }
      if (taiex.resistance?.length > 0) {
        const resists = taiex.resistance.map(s => `${s.label}=${s.value.toFixed(0)}`).join(', ');
        lines.push(`    Resistance: ${resists}`);
      }
    } else {
      lines.push('  [TAIEX] 資料不足');
    }
  }

  _renderCrossAsset(lines, phaseResult, breadth, vix3m, putCallRatio) {
    const ind = phaseResult.indicators || {};

    // VIX
    if (ind.vix != null) {
      lines.push(`  VIX: ${ind.vix.toFixed(1)}${vix3m != null ? ` | VIX3M: ${vix3m.toFixed(1)}` : ''}`);
    }

    // Breadth
    if (breadth.state) {
      const modeSuffix = breadth.mode === 'PRIMARY_RSP_SPY' ? '(RSP/SPY)' : breadth.mode === 'SECONDARY_WATCHLIST' ? '(Watchlist)' : '';
      lines.push(`  Breadth: ${breadth.state} ${modeSuffix}`);
      if (breadth.degraded) lines.push('    ⚠️ Breadth data incomplete');
    }

    // HY Spread
    if (ind.hySpread != null) {
      lines.push(`  HY Spread: ${ind.hySpread.toFixed(2)}`);
    }

    // Put/Call Ratio
    if (putCallRatio?.value != null) {
      lines.push(`  Put/Call Ratio: ${putCallRatio.value.toFixed(2)} (as of ${putCallRatio.asOf || 'N/A'})`);
    }
  }
}

module.exports = { TacticalRenderer };
