'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function _findRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return path.join(__dirname, '../../..');
  }
}

const DEFAULT_STATE_PATH = path.join(_findRepoRoot(), 'data/runtime/alert-state.json');

class AlertState {
  constructor(options = {}) {
    this.filePath = options.filePath || DEFAULT_STATE_PATH;
    this.resolvedRetentionMs = options.resolvedRetentionMs || 7 * 24 * 60 * 60 * 1000;
    this.state = {};
    this._load();
  }

  record(key, meta = {}) {
    const now = Date.now();
    const existing = this.state[key];

    if (existing && existing.status === 'active') {
      existing.lastSeenAt = now;
      existing.count += 1;
      existing.lastSeverity = meta.severity || existing.lastSeverity;
      existing.lastTitle = meta.title || existing.lastTitle;
    } else {
      this.state[key] = {
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
        status: 'active',
        lastSeverity: meta.severity || 'INFO',
        source: meta.source || '',
        component: meta.component || '',
        lastTitle: meta.title || ''
      };
    }

    const entry = this.state[key];
    this._save();

    return {
      count: entry.count,
      durationMs: entry.lastSeenAt - entry.firstSeenAt,
      isNew: entry.count === 1,
      snapshot: { ...entry }
    };
  }

  resolve(key, meta = {}) {
    const entry = this.state[key];
    if (!entry || entry.status !== 'active') {
      return { wasActive: false, count: 0, durationMs: 0, snapshot: null };
    }

    const now = Date.now();
    const durationMs = now - entry.firstSeenAt;

    entry.status = 'resolved';
    entry.resolvedAt = now;
    entry.resolveMode = meta.mode || 'soft';

    this._save();

    return {
      wasActive: true,
      count: entry.count,
      durationMs,
      snapshot: { ...entry }
    };
  }

  get(key) {
    return this.state[key] || null;
  }

  getContext(key) {
    const entry = this.state[key];
    if (!entry) return null;

    return {
      count: entry.count,
      durationMs: entry.lastSeenAt - entry.firstSeenAt,
      status: entry.status,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      lastSeverity: entry.lastSeverity,
      source: entry.source,
      component: entry.component,
      lastTitle: entry.lastTitle
    };
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const key of Object.keys(this.state)) {
      const entry = this.state[key];
      if (entry.status === 'resolved' && entry.resolvedAt) {
        if (now - entry.resolvedAt > this.resolvedRetentionMs) {
          delete this.state[key];
          removed++;
        }
      }
    }

    if (removed > 0) this._save();
    return removed;
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.state = {};
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.state = JSON.parse(raw);
    } catch (err) {
      // 壞檔：備份後重建
      try {
        const backupPath = this.filePath + `.corrupt.${Date.now()}`;
        if (fs.existsSync(this.filePath)) {
          fs.renameSync(this.filePath, backupPath);
        }
      } catch (_) { /* ignore backup failure */ }
      this.state = {};
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      // 寫入失敗不中斷主流程
      if (typeof console !== 'undefined') {
        console.error('[alert-state] save failed:', err.message);
      }
    }
  }
}

module.exports = AlertState;
