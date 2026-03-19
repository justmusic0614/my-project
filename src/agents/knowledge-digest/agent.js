#!/usr/bin/env node
/**
 * Knowledge Digest Agent — CLI 入口
 *
 * 用法：
 *   node agent.js help                  # 顯示說明
 *   node agent.js status                # 顯示知識庫統計
 *   node agent.js add-url <url>         # 新增 URL 到知識庫
 *   node agent.js add-note <title>      # 新增筆記
 *   node agent.js query <keyword>       # 搜尋知識庫
 *   node agent.js daily-review         # 每日複習
 *   node agent.js inbox                # 查看待讀 inbox
 *   node agent.js semantic-search <q>  # 語義搜尋
 *   node agent.js weekly               # 週報
 *   node agent.js ingest <file>        # Ingest 本地檔案
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
    const result = exec(`node ${SCRIPTS_DIR}/digest.js stats`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'add-url': {
    const url = args[0];
    if (!url) {
      console.error('Error: URL required. Usage: node agent.js add-url <url>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/digest.js add-url ${url}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'add-note': {
    if (args.length === 0) {
      console.error('Error: title required. Usage: node agent.js add-note <title>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/digest.js add-note ${args.join(' ')}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'query': {
    if (args.length === 0) {
      console.error('Error: keyword required. Usage: node agent.js query <keyword>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/digest.js query ${args.join(' ')}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'daily-review': {
    const result = exec(`node ${SCRIPTS_DIR}/digest.js daily-review`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'inbox': {
    const result = exec(`node ${SCRIPTS_DIR}/digest.js inbox`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'mark-read': {
    const id = args[0];
    if (!id) {
      console.error('Error: ID required. Usage: node agent.js mark-read <id>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/digest.js mark-read ${id}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'archive': {
    const result = exec(`node ${SCRIPTS_DIR}/digest.js archive ${args.join(' ')}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'semantic-search': {
    if (args.length === 0) {
      console.error('Error: query required. Usage: node agent.js semantic-search <query>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/digest.js semantic-search ${args.join(' ')}`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'weekly': {
    const result = exec(`node ${SCRIPTS_DIR}/digest.js weekly`);
    console.log(result.output);
    if (!result.ok) process.exit(1);
    break;
  }

  case 'ingest': {
    const file = args[0];
    if (!file) {
      console.error('Error: file required. Usage: node agent.js ingest <file>');
      process.exit(1);
    }
    const result = exec(`node ${SCRIPTS_DIR}/digest.js ingest ${file}`);
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
Knowledge Digest Agent

Usage:
  node agent.js help                   顯示說明
  node agent.js status                 知識庫統計
  node agent.js add-url <url>          新增 URL
  node agent.js add-note <title>       新增筆記
  node agent.js query <keyword>        搜尋知識庫
  node agent.js daily-review           每日複習
  node agent.js inbox                  查看待讀 inbox
  node agent.js mark-read <id>         標記已讀
  node agent.js archive [id]           歸檔
  node agent.js semantic-search <q>   語義搜尋
  node agent.js weekly                 週報
  node agent.js ingest <file>          Ingest 本地檔案
`);
}
