'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('./config');

/**
 * 讀取各 agent runtime → normalized payload
 *
 * 每個區塊格式：
 *   { status: 'ok'|'degraded'|'error', data_freshness: 'fresh'|'stale'|'missing', ... }
 * degraded 必須附 reason；stale 必須附 age_hours
 */

function _readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function _ageHours(isoOrMs) {
  if (!isoOrMs) return null;
  const ts = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  return (Date.now() - ts) / 3600000;
}

function _freshness(ageHours, thresholdHours) {
  if (ageHours === null) return 'missing';
  return ageHours > thresholdHours ? 'stale' : 'fresh';
}

// ── Market ──────────────────────────────────────────────────────────────────

function collectMarket() {
  const data = _readJson(config.paths.phase4Result);
  if (!data) {
    return { status: 'degraded', reason: 'phase4-result.json not found', data_freshness: 'missing' };
  }

  const processedAt = data.processedAt || null;
  const ageHours    = _ageHours(processedAt);
  const freshness   = _freshness(ageHours, config.staleThresholds.market);

  if (freshness === 'stale') {
    return {
      status: 'degraded',
      reason: 'market data stale',
      data_freshness: 'stale',
      age_hours: Math.round(ageHours * 10) / 10,
    };
  }

  // 取關鍵指標
  const md      = data.marketData || {};
  const taiex   = md.TAIEX  || {};
  const sp500   = md.SP500  || {};
  const vix     = md.VIX    || {};
  const cost    = data.cost  || 0;
  const degraded = data.archive?.degraded || 0;

  const parts = [];
  if (taiex.value)  parts.push(`TAIEX ${taiex.value} (${taiex.changePct >= 0 ? '+' : ''}${taiex.changePct?.toFixed(2) ?? '?'}%)`);
  if (sp500.value)  parts.push(`SPY ${sp500.value} (${sp500.changePct >= 0 ? '+' : ''}${sp500.changePct?.toFixed(2) ?? '?'}%)`);
  if (vix.value)    parts.push(`VIX ${vix.value}`);

  return {
    status:         data.status === 'ok' ? 'ok' : 'degraded',
    summary:        parts.join('，') || '數據不完整',
    source_file:    config.paths.phase4Result,
    data_freshness: freshness,
    cost_usd:       cost,
    degraded_fields: degraded,
    ...(freshness === 'stale' ? { age_hours: Math.round(ageHours * 10) / 10 } : {}),
    ...(data.status !== 'ok' ? { reason: `status=${data.status}` } : {}),
  };
}

// ── System / Alerts ──────────────────────────────────────────────────────────

function collectSystem() {
  const data = _readJson(config.paths.alertState);
  if (!data) {
    return { status: 'ok', active_alerts: 0, data_freshness: 'missing', reason: 'alert-state.json not found' };
  }

  // 找 mtime
  let ageHours = null;
  try {
    const stat = fs.statSync(config.paths.alertState);
    ageHours = _ageHours(stat.mtimeMs);
  } catch {}
  const freshness = _freshness(ageHours, config.staleThresholds.alertState);

  const entries = Object.values(data);
  const activeAlerts = entries.filter(e => e.status === 'active').length;
  const criticals    = entries.filter(e => e.status === 'active' && e.lastSeverity === 'CRITICAL').length;

  return {
    status:         activeAlerts > 0 ? 'degraded' : 'ok',
    active_alerts:  activeAlerts,
    critical_alerts: criticals,
    data_freshness: freshness,
    ...(freshness === 'stale' ? { age_hours: Math.round(ageHours * 10) / 10 } : {}),
    ...(activeAlerts > 0 ? { reason: `${activeAlerts} active alert(s)` } : {}),
  };
}

// ── Knowledge ────────────────────────────────────────────────────────────────

function collectKnowledge() {
  const data = _readJson(config.paths.knowledgeIndex);
  if (!data) {
    return { status: 'degraded', reason: 'knowledge index.json not found', data_freshness: 'missing' };
  }

  let ageHours = null;
  try {
    const stat = fs.statSync(config.paths.knowledgeIndex);
    ageHours = _ageHours(stat.mtimeMs);
  } catch {}
  const freshness = _freshness(ageHours, config.staleThresholds.knowledge);

  const totalChunks = data.totalChunks || data.count || 0;
  const pending     = data.pending || 0;

  return {
    status:         'ok',
    total_chunks:   totalChunks,
    pending_notes:  pending,
    data_freshness: freshness,
    ...(freshness === 'stale' ? { age_hours: Math.round(ageHours * 10) / 10, reason: 'knowledge index stale' } : {}),
  };
}

// ── Security ─────────────────────────────────────────────────────────────────

function collectSecurity() {
  // 找最新的 security report 檔案
  const dir = config.paths.securityReport;
  if (!fs.existsSync(dir)) {
    return { status: 'ok', data_freshness: 'missing', reason: 'security report dir not found' };
  }

  let latestFile = null;
  let latestMtime = 0;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const stat = fs.statSync(path.join(dir, f));
      if (stat.mtimeMs > latestMtime) { latestMtime = stat.mtimeMs; latestFile = path.join(dir, f); }
    }
  } catch {}

  if (!latestFile) {
    return { status: 'ok', data_freshness: 'missing', reason: 'no security report found' };
  }

  const ageHours  = _ageHours(latestMtime);
  const freshness = _freshness(ageHours, config.staleThresholds.security);
  const report    = _readJson(latestFile) || {};

  return {
    status:            'ok',
    ssh_attempts_24h:  report.sshAttempts || report.ssh_attempts_24h || 0,
    data_freshness:    freshness,
    ...(freshness === 'stale' ? { age_hours: Math.round(ageHours * 10) / 10, reason: 'security report stale' } : {}),
  };
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

function collect() {
  const now = new Date().toISOString();
  const windowStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const market    = _safeCollect('market',    collectMarket);
  const system    = _safeCollect('system',    collectSystem);
  const knowledge = _safeCollect('knowledge', collectKnowledge);
  const security  = _safeCollect('security',  collectSecurity);

  return {
    generated_at: now,
    time_window: { start: windowStart, end: now },
    market,
    system,
    knowledge,
    security,
  };
}

function _safeCollect(name, fn) {
  try {
    return fn();
  } catch (err) {
    return { status: 'error', reason: `collector crashed: ${err.message}`, data_freshness: 'missing' };
  }
}

module.exports = { collect };
