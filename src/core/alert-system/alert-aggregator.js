'use strict';

class AlertAggregator {
  constructor(options = {}) {
    this.flushIntervalMs = options.flushIntervalMs || 5 * 60 * 1000;
    this.cooldownMs = options.cooldownMs || 30 * 60 * 1000;
    this.onFlush = options.onFlush || (() => {});

    this.buffer = [];
    this.timer = null;
    this.cooldowns = new Map();  // key -> lastFlushedAt
    this.isFlushing = false;
  }

  push(event) {
    if (this._shouldFlushImmediately(event)) {
      this.buffer.push(event);
      this.flush();
      return;
    }

    // WARN：進 buffer，啟動 timer
    this.buffer.push(event);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.flushIntervalMs);
    }
  }

  async flush() {
    if (this.isFlushing) return;
    if (this.buffer.length === 0) return;

    this.isFlushing = true;
    try {
      const events = this.buffer.splice(0);
      const groups = this._groupByKey(events);
      const filtered = this._applyCooldown(groups);

      if (filtered.length > 0) {
        await this.onFlush(filtered);
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error('[alert-aggregator] flush error:', err.message);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  _groupByKey(events) {
    const map = new Map();

    for (const event of events) {
      const key = event.key;
      if (!map.has(key)) {
        map.set(key, {
          key,
          type: event.type,
          severity: event.severity,
          source: event.source,
          component: event.component,
          title: event.title,
          count: 0,
          events: []
        });
      }
      const group = map.get(key);
      group.count += 1;
      group.events.push(event);
      // 取最高 severity
      if (this._severityRank(event.severity) > this._severityRank(group.severity)) {
        group.severity = event.severity;
      }
    }

    return Array.from(map.values());
  }

  _applyCooldown(groups) {
    const now = Date.now();
    return groups.filter(group => {
      // ERROR/CRITICAL 不受 cooldown 限制
      if (group.severity === 'ERROR' || group.severity === 'CRITICAL') {
        this.cooldowns.set(group.key, now);
        return true;
      }

      const lastFlushed = this.cooldowns.get(group.key);
      if (lastFlushed && (now - lastFlushed) < this.cooldownMs) {
        return false; // cooldown 中，不送
      }

      this.cooldowns.set(group.key, now);
      return true;
    });
  }

  _shouldFlushImmediately(event) {
    return event.severity === 'ERROR' || event.severity === 'CRITICAL';
  }

  _severityRank(severity) {
    const ranks = { INFO: 0, WARN: 1, ERROR: 2, CRITICAL: 3 };
    return ranks[severity] || 0;
  }

  destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

module.exports = AlertAggregator;
