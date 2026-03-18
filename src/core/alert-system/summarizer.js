'use strict';

const { buildFooter } = require('./templates');

function formatDuration(ms) {
  if (!ms || ms <= 0) return '';
  const hours = ms / (1000 * 60 * 60);
  if (hours >= 24) return `${(hours / 24).toFixed(1)} 天`;
  if (hours >= 1) return `${hours.toFixed(1)} 小時`;
  const minutes = ms / (1000 * 60);
  return `${Math.round(minutes)} 分鐘`;
}

function pickTopDetails(event) {
  const details = [];
  const data = event.data || {};

  if (data.error) details.push(data.error);
  if (data.memAvailable != null && data.threshold != null) {
    details.push(`MemAvailable=${data.memAvailable}MB < threshold=${data.threshold}MB`);
  }
  if (data.diffPct != null) details.push(`差異 ${data.diffPct}%`);
  if (data.statusCode != null) details.push(`HTTP ${data.statusCode}`);
  if (data.reason) details.push(data.reason);

  return details.slice(0, 2);
}

function buildNarratorPayload(groupOrEvent, stateContext, options = {}) {
  const isGroup = Array.isArray(groupOrEvent.events);
  const lastEvent = isGroup
    ? groupOrEvent.events[groupOrEvent.events.length - 1]
    : groupOrEvent;

  const count = stateContext ? stateContext.count : (groupOrEvent.count || 1);
  const durationMs = stateContext
    ? stateContext.lastSeenAt - stateContext.firstSeenAt
    : 0;

  const severity = groupOrEvent.severity || (stateContext && stateContext.lastSeverity) || 'INFO';
  const source = groupOrEvent.source || '';
  const component = groupOrEvent.component || '';
  const key = groupOrEvent.key || '';

  return {
    severity,
    source,
    component,
    eventKey: key,
    title: groupOrEvent.title || '',
    count,
    durationText: formatDuration(durationMs),
    details: pickTopDetails(lastEvent),
    actionHint: severity === 'CRITICAL' || severity === 'ERROR'
      ? ''
      : '可考慮稍後處理，先不用現在處理。',
    footer: buildFooter(source, severity, key)
  };
}

function buildRecoveryPayload(resolveResult, meta = {}, options = {}) {
  const snapshot = resolveResult.snapshot || {};
  const source = meta.source || snapshot.source || '';
  const key = meta.key || '';

  return {
    eventKey: key,
    source,
    component: meta.component || snapshot.component || '',
    title: snapshot.lastTitle || key,
    count: resolveResult.count || 0,
    durationText: formatDuration(resolveResult.durationMs || 0),
    resolveMode: meta.mode || 'soft',
    footer: buildFooter(source, 'RESOLVED', key)
  };
}

module.exports = { buildNarratorPayload, buildRecoveryPayload, formatDuration, pickTopDetails };
