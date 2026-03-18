'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('./config');
const { normalizeEvent, validateEvent } = require('./schemas');
const { classifySeverity } = require('./severity');
const { renderAlertTemplate, renderRecoveryTemplate, buildFooter } = require('./templates');
const { buildNarratorPayload, buildRecoveryPayload } = require('./summarizer');
const { narrate } = require('./ai-narrator');
const AlertState = require('./alert-state');
const AlertAggregator = require('./alert-aggregator');
const TelegramNotifier = require('./notifier-telegram');

// ── Memory Log 輔助 ──────────────────────────────────────────────────────────

function _findRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return path.join(__dirname, '../../..');
  }
}

const _REPO_ROOT = _findRepoRoot();

// Coalesce cache：key → last write timestamp（in-memory，同 process 內）
const _coalesceCache = new Map();
const COALESCE_MS = 5 * 60 * 1000; // 5 分鐘

/**
 * 寫入 alert event 到 workspace memory daily log
 * 格式：/home/clawbot/clawd/memory/YYYY-MM-DD.md
 * 只收 WARN/ERROR/CRITICAL，INFO 不進 memory
 */
function _appendAlertMemory(event, severity) {
  try {
    if (!['WARN', 'ERROR', 'CRITICAL'].includes(severity)) return;

    const key = event.key;
    const now = Date.now();

    // Coalesce：5 分鐘內同 key 只寫一筆
    const lastWrite = _coalesceCache.get(key);
    if (lastWrite && (now - lastWrite) < COALESCE_MS) return;
    _coalesceCache.set(key, now);

    const isoNow  = new Date(now).toISOString();
    const dateStr = isoNow.slice(0, 10); // YYYY-MM-DD
    const hhmm    = isoNow.slice(11, 16); // HH:MM (UTC)

    const memDir  = path.join(_REPO_ROOT, 'memory');
    const memFile = path.join(memDir, `${dateStr}.md`);

    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

    // 若檔案不存在，建立標題
    if (!fs.existsSync(memFile)) {
      fs.writeFileSync(memFile, `# ${dateStr}\n\n## Alert Events\n`, 'utf8');
    }

    const impact  = event.data?.impact || '';
    const line1   = `- ${hhmm} ${event.title || key} <!-- ${isoNow} -->`;
    const line2   = `  - severity: ${severity} | source: ${event.source} | key: ${key}`;
    const line3   = impact ? `  - impact: ${impact}` : null;

    const entry   = [line1, line2, ...(line3 ? [line3] : [])].join('\n') + '\n';
    fs.appendFileSync(memFile, entry, 'utf8');
  } catch {
    // memory log 失敗不中斷主流程
  }
}

/**
 * 寫入 resolve event 到 workspace memory daily log
 */
function _appendResolveMemory(key, source, isoNow) {
  try {
    const dateStr = isoNow.slice(0, 10);
    const hhmm    = isoNow.slice(11, 16);

    const memDir  = path.join(_REPO_ROOT, 'memory');
    const memFile = path.join(memDir, `${dateStr}.md`);

    if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });

    if (!fs.existsSync(memFile)) {
      fs.writeFileSync(memFile, `# ${dateStr}\n\n## Resolved\n`, 'utf8');
    }

    // 若 ## Resolved 區塊不存在，追加
    const content = fs.readFileSync(memFile, 'utf8');
    if (!content.includes('## Resolved')) {
      fs.appendFileSync(memFile, '\n## Resolved\n', 'utf8');
    }

    const line = `- ${hhmm} ${key} resolved (source: ${source || 'unknown'}) <!-- ${isoNow} -->\n`;
    fs.appendFileSync(memFile, line, 'utf8');
  } catch {
    // memory log 失敗不中斷主流程
  }
}

class AlertManager {
  constructor(options = {}) {
    this.config = { ...config, ...options };

    this.state = new AlertState({
      resolvedRetentionMs: this.config.resolvedRetentionMs
    });

    this.notifier = new TelegramNotifier();

    this.aggregator = new AlertAggregator({
      flushIntervalMs: this.config.flushIntervalMs,
      cooldownMs: this.config.cooldownMs,
      onFlush: (groups) => this._handleFlush(groups)
    });

    this._log('info', 'AlertManager initialized');
  }

  async emit(event) {
    try {
      // 1. normalize + validate
      const normalized = normalizeEvent(event);
      const validation = validateEvent(normalized);
      if (!validation.valid) {
        this._log('warn', `invalid event: ${validation.reason}`, { input: event });
        return null;
      }

      // 2. state.record
      const stateResult = this.state.record(normalized.key, {
        severity: null, // severity 還沒算
        source: normalized.source,
        component: normalized.component,
        title: normalized.title
      });

      // 3. classify severity
      const severity = classifySeverity(normalized, stateResult.snapshot, this.config);

      // 更新 state 中的 severity
      const entry = this.state.get(normalized.key);
      if (entry) entry.lastSeverity = severity;

      // 4. 組成附帶 severity 的事件
      const enriched = { ...normalized, severity };

      // 5. INFO → 只 log
      if (severity === 'INFO') {
        this._log('debug', `INFO event logged: ${normalized.key}`);
        return { severity, action: 'logged' };
      }

      // 6. WARN / ERROR / CRITICAL → aggregator
      this.aggregator.push(enriched);
      return { severity, action: 'queued' };

    } catch (err) {
      this._log('error', `emit failed: ${err.message}`);
      return null;
    }
  }

  async resolve(key, meta = {}) {
    try {
      const result = this.state.resolve(key, meta);

      if (!result.wasActive) {
        this._log('debug', `resolve skipped (not active): ${key}`);
        return { notified: false };
      }

      // summarizer → recovery payload → narrator
      const payload = buildRecoveryPayload(result, { ...meta, key });
      const text = await narrate(payload);
      const sendResult = await this.notifier.sendMessage(text);

      if (!sendResult.ok) {
        this._log('warn', `recovery notify failed: ${sendResult.reason}`, { key });
      }

      // Memory log：寫入 resolved 記錄
      _appendResolveMemory(key, meta.source || result.snapshot?.source, new Date().toISOString());

      return { notified: sendResult.ok };

    } catch (err) {
      this._log('error', `resolve failed: ${err.message}`);
      return { notified: false };
    }
  }

  async _handleFlush(groups) {
    for (const group of groups) {
      try {
        const stateContext = this.state.getContext(group.key);

        // summarizer → narrator payload
        const payload = buildNarratorPayload(group, stateContext);

        // narrator（成功用 AI 文字，失敗 fallback 到模板）
        const text = await narrate(payload);
        const sendResult = await this.notifier.sendMessage(text);

        if (!sendResult.ok) {
          this._log('warn', `notify failed for ${group.key}: ${sendResult.reason}`);
        }

        // Memory log：寫入 workspace memory daily log
        _appendAlertMemory(group, stateContext?.lastSeverity || group.severity || 'WARN');

      } catch (err) {
        this._log('error', `flush handler error for ${group.key}: ${err.message}`);
      }
    }
  }

  _log(level, message, context) {
    const prefix = '[alert-manager]';
    if (level === 'error') {
      console.error(prefix, message, context || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, context || '');
    } else {
      // debug/info 不印，除非 LOG_LEVEL=debug
      if (process.env.LOG_LEVEL === 'debug') {
        console.log(prefix, message, context || '');
      }
    }
  }

  destroy() {
    this.aggregator.destroy();
  }
}

module.exports = AlertManager;
