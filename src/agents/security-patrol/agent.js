#!/usr/bin/env node
// security-patrol agent.js — v1: only status implemented

'use strict';

const fs   = require('fs');
const path = require('path');

const AGENT_NAME = 'security-patrol';
const RUNTIME_PATH = path.join(__dirname, 'data/runtime/latest.json');

// ── status ──────────────────────────────────────────────────────────────────

function status(format) {
  const now = new Date().toISOString();

  let latest = null;
  try {
    latest = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
  } catch {}

  if (format === 'json') {
    if (!latest) {
      return JSON.stringify({
        ok: true,
        agent: AGENT_NAME,
        generatedAt: now,
        summary: 'No patrol data available yet',
        data: null,
        error: null,
      });
    }

    const services = (latest.services || []).map(s => ({
      name: s.name || s.service || 'unknown',
      status: _normalizeServiceStatus(s.status || s.state),
    }));

    return JSON.stringify({
      ok: true,
      agent: AGENT_NAME,
      generatedAt: now,
      summary: `VPS health: ${latest.overall || 'unknown'}, ${services.length} services checked`,
      data: {
        asOf: latest.timestamp || latest.lastRun || null,
        overall: latest.overall || 'unknown',
        memAvailMB: latest.memory?.available_mb ?? null,
        diskPercent: latest.disk?.usage_percent ?? null,
        cpuLoad: latest.cpu?.load_1m ?? null,
        services,
      },
      error: null,
    });
  }

  // text format (fallback)
  if (!latest) return 'security-patrol: no data available';
  return JSON.stringify(latest, null, 2);
}

function _normalizeServiceStatus(raw) {
  if (!raw) return 'unknown';
  const s = String(raw).toLowerCase();
  if (s === 'healthy' || s === 'active' || s === 'running' || s === 'ok') return 'healthy';
  if (s === 'warning' || s === 'degraded') return 'warning';
  if (s === 'critical' || s === 'failed' || s === 'dead' || s === 'error') return 'critical';
  return 'unknown';
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : null;

  switch (command) {
    case 'status':
      console.log(status(format));
      break;
    default:
      console.log(`security-patrol agent v1\n\nCommands:\n  status [--format json]    Show latest patrol results`);
  }
}

module.exports = { status };
