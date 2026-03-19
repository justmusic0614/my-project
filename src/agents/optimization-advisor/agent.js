#!/usr/bin/env node
/**
 * Optimization Advisor Agent — CLI 入口
 *
 * 用法：
 *   node agent.js help           # 顯示說明
 *   node agent.js status         # 執行 SRE 掃描（scan-v2）並顯示結果
 *   node agent.js scan           # 執行舊版規則掃描
 *   node agent.js scan-v2        # 執行 SRE rule-based 掃描
 *   node agent.js scan-v2 --push # 掃描並推播到 Telegram
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function exec(cmd, opts = {}) {
  try {
    return { ok: true, output: execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim() };
  } catch (e) {
    return { ok: false, output: (e.stdout || '') + (e.stderr || '') };
  }
}

const [,, command, ...args] = process.argv;

switch (command) {
  case 'help':
  case '--help':
    printUsage();
    break;

  case 'status': {
    // status 用 scan-v2（SRE 掃描），不推播
    const result = exec(`node ${SCRIPTS_DIR}/advisor.js scan-v2`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'scan': {
    const result = exec(`node ${SCRIPTS_DIR}/advisor.js scan`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'scan-v2': {
    const pushFlag = args.includes('--push') ? '--push' : '';
    const result = exec(`node ${SCRIPTS_DIR}/advisor.js scan-v2 ${pushFlag}`.trim());
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  default:
    if (command) console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}

function printUsage() {
  console.log(`
Optimization Advisor Agent

Usage:
  node agent.js help               顯示說明
  node agent.js status             執行 SRE 掃描並顯示結果
  node agent.js scan               舊版規則掃描（功能擴展 + 技術優化）
  node agent.js scan-v2            SRE rule-based 掃描（5 條規則）
  node agent.js scan-v2 --push     掃描並推播到 Telegram
`);
}
