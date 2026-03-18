'use strict';

const LEVELS = ['INFO', 'WARN', 'ERROR', 'CRITICAL'];

function classifySeverity(event, stateSnapshot, config = {}) {
  const overrides = config.severityOverrides || {};

  // 1. config override 優先
  if (overrides[event.key] && LEVELS.includes(overrides[event.key])) {
    return overrides[event.key];
  }

  // 2. baseline by type
  const type = event.type || '';
  let severity;

  if (type === 'critical-no-data') {
    severity = 'CRITICAL';
  } else if (type === 'pipeline-fail') {
    severity = 'ERROR';
  } else if (type === 'resource-guard-skip' || type === 'cross-check-fail') {
    severity = 'WARN';
  } else if (type === 'degradation') {
    severity = stateSnapshot && stateSnapshot.count >= 3 ? 'WARN' : 'INFO';
  } else {
    severity = 'INFO';
  }

  // 3. escalation：同 key count >= 3 且 type 含 fail → CRITICAL
  if (stateSnapshot && stateSnapshot.count >= 3 && type.includes('fail')) {
    severity = 'CRITICAL';
  }

  return severity;
}

module.exports = { classifySeverity, LEVELS };
