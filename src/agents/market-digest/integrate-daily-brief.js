#!/usr/bin/env node
/**
 * @deprecated — 使用 `node index.js today` 取代
 * 保留為橋接，確保 VPS cron/AGENTS.md 向後相容
 */

'use strict';

const { execFileSync } = require('child_process');

try {
  execFileSync(process.execPath, ['index.js', 'today', ...process.argv.slice(2)], {
    cwd: __dirname,
    stdio: 'inherit'
  });
} catch (err) {
  process.exit(err.status || 1);
}
