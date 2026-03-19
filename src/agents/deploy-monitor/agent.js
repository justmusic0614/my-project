#!/usr/bin/env node
/**
 * Deploy Monitor Agent — CLI 入口
 *
 * 用法：
 *   node agent.js help       # 顯示說明
 *   node agent.js status     # 執行健康檢查（所有服務）
 *   node agent.js deploy <agent>   # 部署指定 agent
 *   node agent.js health <service> # 查詢單一服務健康狀態
 *   node agent.js list       # 列出受監控的服務
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
    console.log('Running health check...\n');
    const result = exec(`bash ${SCRIPTS_DIR}/simple-health.sh`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'deploy': {
    const agent = args[0];
    if (!agent) {
      console.error('Error: agent name required. Usage: node agent.js deploy <agent>');
      process.exit(1);
    }
    console.log(`Deploying ${agent}...`);
    const result = exec(`node ${SCRIPTS_DIR}/deploy.js deploy ${agent}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'health': {
    const service = args[0];
    if (!service) {
      console.error('Error: service name required. Usage: node agent.js health <service>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/deploy.js health ${service}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'list': {
    const result = exec(`node ${SCRIPTS_DIR}/deploy.js list`);
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
Deploy Monitor Agent

Usage:
  node agent.js help                   顯示說明
  node agent.js status                 執行所有服務健康檢查
  node agent.js deploy <agent>         部署指定 agent（market-digest 等）
  node agent.js health <service>       查詢單一服務健康狀態
  node agent.js list                   列出受監控的服務
`);
}
