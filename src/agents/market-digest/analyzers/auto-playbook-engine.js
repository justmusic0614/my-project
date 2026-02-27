'use strict';

/**
 * auto-playbook-engine.js
 *
 * 把日報從「給方向」升級成「給劇本」：
 *   - Base case（主情境）：現在最合理的操作框架
 *   - If/Then（觸發劇本）：突破/跌破/風險升級時的下一步
 *   - Risk budget（倉位建議）：用 bias + riskOffScore + triggers 強制落地
 *
 * 輸入：evaluate({ tacticalBias, phaseEngine, keyLevels, triggers,
 *                  contradictions, riskOffScore, lastPrice })
 * 輸出：{ baseCase, levels, scenarios, riskRules, confidence }
 */

const CONF = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

function _asArray(x) { return Array.isArray(x) ? x : []; }

function _toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function _getFiredTriggers(triggers) {
  if (!triggers) return [];
  // array: treat as items, keep those triggered/active
  if (Array.isArray(triggers)) {
    return triggers.filter(t => t?.triggered || t?.active);
  }
  if (Array.isArray(triggers.fired)) return triggers.fired;
  if (Array.isArray(triggers.items)) return triggers.items.filter(t => t?.triggered || t?.active);
  return [];
}

function _hasMajorContradictions(contradictions) {
  if (!contradictions) return false;
  let items = [];
  if (Array.isArray(contradictions)) items = contradictions;
  else if (Array.isArray(contradictions.items)) items = contradictions.items;

  const uniq = new Set(
    items
      .map(c => String(c?.message || c?.description || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return uniq.size >= 2;
}

function _confidenceDowngrade(conf) {
  if (conf === CONF.HIGH) return CONF.MEDIUM;
  return CONF.LOW;
}

function _levelRank(t) {
  const s = String(t?.level || t?.severity || '').toUpperCase();
  if (s === 'HIGH') return 0;
  if (s === 'MEDIUM') return 1;
  if (s === 'LOW') return 2;
  return 99;
}

function _pickFirstLevel(levels, side) {
  // side: 'support' | 'resistance'
  const arr = _asArray(levels?.[side]);
  if (!arr.length) return null;
  // prefer priority numeric if present
  const hasPri = arr.every(x => x && Number.isFinite(Number(x.priority)));
  const x = hasPri ? [...arr].sort((a, b) => Number(a.priority) - Number(b.priority))[0] : arr[0];
  const value = _toNum(x?.value);
  if (value == null) return null;
  return { label: String(x?.label || side).toUpperCase(), value };
}

function _spxKeyLevels(keyLevels) {
  const spx = keyLevels?.spx || keyLevels?.sp500 || keyLevels?.SP500 || null;
  if (!spx) return { upside: null, downside: null };
  return {
    upside: _pickFirstLevel(spx, 'resistance'),
    downside: _pickFirstLevel(spx, 'support'),
  };
}

function _fmtNum(n, dp = 2) {
  const x = _toNum(n);
  if (x == null) return null;
  return x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

function evaluate(input = {}) {
  const {
    tacticalBias,
    phaseEngine,
    keyLevels,
    triggers,
    contradictions,
    riskOffScore,
    lastPrice,
  } = input;

  const rso = Number.isFinite(Number(riskOffScore)) ? Number(riskOffScore) : null;

  const fired = _getFiredTriggers(triggers).sort((a, b) => _levelRank(a) - _levelRank(b));
  const highFired = fired.some(t => String(t?.level || t?.severity || '').toUpperCase() === 'HIGH');

  const tbBias = String(tacticalBias?.bias || '').toUpperCase() || 'NEUTRAL';
  const tbConf = String(tacticalBias?.confidence || phaseEngine?.confidence || CONF.MEDIUM).toUpperCase();
  let confidence = (tbConf === CONF.HIGH || tbConf === CONF.MEDIUM) ? tbConf : CONF.MEDIUM;

  // contradictions: primarily downgrade confidence, major -> further downgrade
  if (contradictions && (Array.isArray(contradictions) || Array.isArray(contradictions.items))) {
    confidence = _confidenceDowngrade(confidence);
    if (_hasMajorContradictions(contradictions)) confidence = CONF.LOW;
  }

  // if HIGH triggers fired, confidence should not be HIGH
  if (highFired && confidence === CONF.HIGH) confidence = CONF.MEDIUM;

  const { upside, downside } = _spxKeyLevels(keyLevels);
  const px = _toNum(lastPrice);

  // baseCase mode
  // - if riskOffScore >= 60 => RISK_OFF
  // - else if upside & downside exist and price between -> RANGE
  // - else -> TREND
  let mode = 'TREND';
  if (rso != null && rso >= 60) mode = 'RISK_OFF';
  else if (px != null && upside?.value != null && downside?.value != null) {
    if (px < upside.value && px > downside.value) mode = 'RANGE';
  } else if (upside && downside) {
    mode = 'RANGE';
  }

  const upTxt = upside ? `${_fmtNum(upside.value)} (${upside.label})` : 'N/A';
  const dnTxt = downside ? `${_fmtNum(downside.value)} (${downside.label})` : 'N/A';
  const pxTxt = px != null ? _fmtNum(px) : 'N/A';

  const baseSummary = [
    `Base case: ${mode}`,
    (upside && downside) ? `(SPX ${dnTxt}–${upTxt})` : '',
    `| Bias: ${tbBias}`,
    (rso != null) ? `| RiskOff: ${rso}` : '',
    `| SPX: ${pxTxt}`,
  ].filter(Boolean).join(' ');

  const scenarios = [];

  // breakout scenario
  if (upside) {
    scenarios.push({
      title: 'If breakout',
      when: `SPX > ${_fmtNum(upside.value)} (${upside.label})`,
      actions: [
        tbBias === 'BEARISH' ? '先減少對沖，再小幅回補風險資產（分批）' : '分批增加風險資產/高 beta（避免追價滿倉）',
        '若隔日續強再加碼；若假突破立刻降回',
      ],
      confirms: [
        'VIX 不上升（或回落）',
        'Breadth 非 NARROW（若可得）',
      ],
      invalidates: [
        `突破後 1–2 日跌回 ${_fmtNum(upside.value)} 下方並收盤站不回`,
      ],
    });
  }

  // breakdown scenario
  if (downside) {
    scenarios.push({
      title: 'If breakdown',
      when: `SPX < ${_fmtNum(downside.value)} (${downside.label})`,
      actions: [
        '降低高 beta / 槓桿，提升現金或避險（put / 反向 ETF / 減倉）',
        '優先處理曝險最大的部位（半導體/高估值/高波動）',
      ],
      confirms: [
        'VIX 上行 / credit spread 擴大（若有）',
        rso != null ? `RiskOff score 維持高檔（目前 ${rso}）` : 'RiskOff score 升高',
      ],
      invalidates: [
        `跌破後隔日迅速收復 ${_fmtNum(downside.value)} 且收盤站穩`,
      ],
    });
  }

  // risk-off escalation
  if (rso != null && rso >= 40) {
    scenarios.push({
      title: 'If risk-off escalates',
      when: (rso >= 60) ? 'RiskOff score ≥ 60' : 'RiskOff score ≥ 40 且持續上升',
      actions: [
        '將倉位從「防守」調整為「更保守」：減少高 beta、提高現金/對沖比例',
        '避免逆勢抄底；等待波動回落與關鍵位收復',
      ],
      confirms: [
        '高波動延續（VIX / intraday range 上升）',
        '風險資產反彈弱、避險資產走強',
      ],
      invalidates: [
        'RiskOff score 明顯回落 + 指數收復關鍵支撐',
      ],
    });
  }

  const riskRules = [];
  if (highFired) riskRules.push('HIGH triggers fired → 立即降低高 beta / 槓桿（優先處理最大曝險）');
  if (_hasMajorContradictions(contradictions)) riskRules.push('Major contradictions → 降低信心、縮小部位、避免加碼追價');
  if (confidence === CONF.LOW) riskRules.push('Confidence LOW → 以風控為優先：小倉位/分批/更嚴格停損');

  // keep output stable
  return {
    baseCase: { mode, summary: baseSummary },
    levels: { upside, downside },
    scenarios,
    riskRules,
    confidence,
  };
}

module.exports = { evaluate };
