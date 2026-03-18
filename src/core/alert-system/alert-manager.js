'use strict';

const config = require('./config');
const { normalizeEvent, validateEvent } = require('./schemas');
const { classifySeverity } = require('./severity');
const { renderAlertTemplate, renderRecoveryTemplate, buildFooter } = require('./templates');
const { buildNarratorPayload, buildRecoveryPayload } = require('./summarizer');
const { narrate } = require('./ai-narrator');
const AlertState = require('./alert-state');
const AlertAggregator = require('./alert-aggregator');
const TelegramNotifier = require('./notifier-telegram');

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
