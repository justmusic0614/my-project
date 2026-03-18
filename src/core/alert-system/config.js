'use strict';

module.exports = {
  flushIntervalMs: 5 * 60 * 1000,       // WARN buffer flush 間隔
  cooldownMs: 30 * 60 * 1000,            // 同 key cooldown
  resolvedRetentionMs: 7 * 24 * 60 * 60 * 1000, // resolved 狀態保留 7 天

  narrator: {
    enabled: true,
    model: 'gpt-4o-mini',
    maxOutputChars: 80,
    timeoutMs: 15000
  },

  telegram: {
    enabled: true,
    includeFooter: true
  },

  severityOverrides: {
    // key -> severity
    // 'collector-fail:social-digest:imap': 'ERROR'
  }
};
