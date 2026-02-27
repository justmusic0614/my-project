'use strict';

const BIAS = {
  BULLISH: 'BULLISH',
  NEUTRAL: 'NEUTRAL',
  DEFENSIVE: 'DEFENSIVE',
  BEARISH: 'BEARISH',
};

const CONF = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
};

const POSITIONING = {
  [BIAS.BULLISH]: 'Increase equity exposure',
  [BIAS.NEUTRAL]: 'Maintain balanced exposure',
  [BIAS.DEFENSIVE]: 'Reduce high-beta exposure',
  [BIAS.BEARISH]: 'Raise cash / hedge',
};

function _asArray(x) {
  return Array.isArray(x) ? x : [];
}

function _upper(x) {
  return typeof x === 'string' ? x.toUpperCase() : '';
}

function _num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// triggers 格式兼容（與 renderer 邏輯一致，但更穩）
// - triggers.fired: array
// - triggers.items: array + triggered===true
// - triggers: array（可能是 fired list 或 full list）→ 取 triggered/fired/active === true
function _getFiredTriggers(triggers) {
  if (!triggers) return [];

  if (Array.isArray(triggers)) {
    // array 可能是 fired list，也可能是 full list
    // 若沒有 triggered/fired/active 欄位，視為已 fired（保守）
    return triggers.filter(t => {
      if (!t) return false;
      if (t.triggered === true || t.fired === true || t.active === true) return true;
      const hasFlag = ('triggered' in t) || ('fired' in t) || ('active' in t);
      return !hasFlag;
    });
  }

  if (Array.isArray(triggers.fired)) return triggers.fired;

  if (Array.isArray(triggers.items)) {
    return triggers.items.filter(t => t && (t.triggered === true || t.fired === true || t.active === true));
  }

  return [];
}

function _getTriggerLevel(t) {
  return _upper(t?.level || t?.severity || t?.priority);
}

function _getPhaseState(phaseEngine) {
  if (!phaseEngine) return 'UNKNOWN';

  // newState may be string
  if (typeof phaseEngine.newState === 'string' && phaseEngine.newState) return phaseEngine.newState;

  const phase =
    phaseEngine.phase ||
    phaseEngine?.newState?.phase ||
    phaseEngine.state ||
    phaseEngine?.newState?.state;

  return typeof phase === 'string' && phase ? phase : 'UNKNOWN';
}

function _getConfidence(phaseEngine) {
  const c = _upper(phaseEngine?.confidence);
  if (c === CONF.LOW || c === CONF.MEDIUM || c === CONF.HIGH) return c;
  return CONF.MEDIUM;
}

function _getSpxKeyLevels(keyLevels) {
  return keyLevels?.spx || keyLevels?.sp500 || keyLevels?.SP500 || null;
}

function _normalizeLevel(x) {
  if (!x || typeof x !== 'object') return null;
  const value = _num(x.value ?? x.price ?? x.level);
  if (value == null) return null;
  const label = String(x.label || x.name || x.type || 'LEVEL');
  return { label, value };
}

function _pickFirstLevel(arr) {
  const xs = _asArray(arr).map(_normalizeLevel).filter(Boolean);
  return xs.length ? xs[0] : null;
}

function _hasContradictions(contradictions) {
  if (!contradictions) return false;
  if (Array.isArray(contradictions)) return contradictions.length > 0;
  if (Array.isArray(contradictions.items)) return contradictions.items.length > 0;
  return false;
}

function _downgrade(bias) {
  if (bias === BIAS.BULLISH) return BIAS.NEUTRAL;
  if (bias === BIAS.NEUTRAL) return BIAS.DEFENSIVE;
  if (bias === BIAS.DEFENSIVE) return BIAS.BEARISH;
  return bias;
}

function _biasFromPhase(phase) {
  const p = _upper(phase);
  if (p.includes('RISK_ON_EARLY')) return BIAS.BULLISH;
  if (p.includes('RISK_ON_MATURE')) return BIAS.NEUTRAL;
  if (p.includes('RISK_OFF')) return BIAS.DEFENSIVE;
  if (p.includes('CRISIS')) return BIAS.BEARISH;
  return BIAS.NEUTRAL;
}

function evaluate({ phaseEngine, keyLevels, triggers, contradictions }) {
  const fired = _getFiredTriggers(triggers);
  const hasHigh = fired.some(t => _getTriggerLevel(t) === 'HIGH');

  let bias;
  let confidence;

  // 1) HIGH triggers override
  if (hasHigh) {
    bias = BIAS.DEFENSIVE;
    confidence = CONF.HIGH;
  } else {
    // 2) Phase decides base bias
    const phase = _getPhaseState(phaseEngine);
    bias = _biasFromPhase(phase);
    confidence = _getConfidence(phaseEngine);
  }

  // 3) contradictions downgrade
  if (_hasContradictions(contradictions)) {
    bias = _downgrade(bias);
    if (confidence === CONF.HIGH) confidence = CONF.MEDIUM;
  }

  // key levels
  const spx = _getSpxKeyLevels(keyLevels);
  const upsideLevel = _pickFirstLevel(spx?.resistance);
  const downsideLevel = _pickFirstLevel(spx?.support);

  return {
    bias,
    confidence,
    upsideLevel: upsideLevel || null,
    downsideLevel: downsideLevel || null,
    positioning: POSITIONING[bias] || POSITIONING[BIAS.NEUTRAL],
  };
}

module.exports = { evaluate };
