#!/usr/bin/env node
// {AGENT_NAME} Agent
// 用法: node agent.js <command> [args...]

const fs = require('fs');
const path = require('path');

// 載入設定
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// --- 指令處理 ---

async function handleCommand(command, args = []) {
  switch (command) {
    case 'run':
      return await run();
    case 'status':
      return await status();
    case 'help':
    default:
      return help();
  }
}

// --- 核心功能（從 src/ 引入） ---

async function run() {
  // TODO: 引入 src/ 下的模組實作核心邏輯
  return { ok: true, message: 'run completed' };
}

async function status() {
  const runtimePath = path.join(__dirname, config.paths.runtime, 'latest.json');
  if (!fs.existsSync(runtimePath)) {
    return { ok: true, message: 'no previous run' };
  }
  return JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
}

function help() {
  return [
    `${config.name} agent`,
    '',
    'Commands:',
    '  run      Execute the agent',
    '  status   Show last run status',
    '  help     Show this message',
  ].join('\n');
}

// --- 入口 ---

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    const result = await handleCommand(command, args);
    if (typeof result === 'string') {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.error(`[${config.name}] Error:`, err.message);
    process.exit(1);
  }
}

main();
