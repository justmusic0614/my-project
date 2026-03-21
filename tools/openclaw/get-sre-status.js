#!/usr/bin/env node
// OpenClaw tool wrapper: get_sre_status
// Spawns security-patrol agent.js status --format json with timeout + cooldown

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const AGENT_NAME = 'security-patrol';
const CMD = ['node', path.join(__dirname, '../../src/agents/security-patrol/agent.js'), 'status', '--format', 'json'];
const TIMEOUT_MS = 5000;
const COOLDOWN_MS = 60000;
const CACHE_FILE = path.join(__dirname, '.cache-sre-status.json');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeError(error, summary) {
  return JSON.stringify({
    ok: false,
    agent: AGENT_NAME,
    generatedAt: new Date().toISOString(),
    summary: summary || `Failed to retrieve ${AGENT_NAME} status`,
    data: null,
    error,
  });
}

function saveCache(json) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify({ ts: Date.now(), json }), 'utf8'); } catch {}
}

function loadCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (raw && raw.ts && raw.json) return raw;
  } catch {}
  return null;
}

// ── cooldown check ───────────────────────────────────────────────────────────

const cached = loadCache();
if (cached && (Date.now() - cached.ts) < COOLDOWN_MS) {
  const age = Math.round((Date.now() - cached.ts) / 1000);
  const result = { ...cached.json };
  result.summary = `Using cached result from ${age} seconds ago: ${result.summary || ''}`.slice(0, 120);
  result.meta = { cooldownHit: true, cached: true, ageSeconds: age };
  console.log(JSON.stringify(result));
  process.exit(0);
}

// ── spawn agent ──────────────────────────────────────────────────────────────

const child = spawn(CMD[0], CMD.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], timeout: TIMEOUT_MS });

let stdout = '';
let stderr = '';

child.stdout.on('data', d => { stdout += d; });
child.stderr.on('data', d => { stderr += d; });

const timer = setTimeout(() => {
  child.kill('SIGKILL');
}, TIMEOUT_MS);

child.on('close', (code) => {
  clearTimeout(timer);

  const output = stdout.trim();

  if (!output) {
    console.log(makeError('empty_response', `${AGENT_NAME} returned no output`));
    process.exit(0);
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    console.log(makeError('invalid_json', `${AGENT_NAME} returned invalid JSON`));
    process.exit(0);
  }

  const result = {
    ok: parsed.ok ?? false,
    agent: parsed.agent || AGENT_NAME,
    generatedAt: parsed.generatedAt || new Date().toISOString(),
    summary: String(parsed.summary || '').slice(0, 120),
    data: parsed.data || null,
    error: parsed.error || null,
  };

  saveCache(result);
  console.log(JSON.stringify(result));
});

child.on('error', (err) => {
  clearTimeout(timer);
  console.log(makeError('spawn_failed', `Failed to start ${AGENT_NAME}: ${err.message}`));
});
