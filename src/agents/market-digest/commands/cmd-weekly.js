/**
 * /weekly — 取得本週週報
 * 功能：讀取最新 weekly-report/ 存檔，或觸發即時生成
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');

const logger = createLogger('cmd:weekly');

const WEEKLY_DIR = path.join(__dirname, '../data/weekly-report');

async function handle(args, config = {}) {
  logger.info('/weekly executing');

  // 尋找最新的週報
  const latest = _findLatestWeeklyReport();
  if (!latest) {
    return [
      '📅 本週週報尚未生成',
      '',
      '週報排程：每週五 17:30 自動推播',
      '💡 若需立即生成：node index.js weekly'
    ].join('\n');
  }

  try {
    const text = fs.readFileSync(latest, 'utf8');
    const stat  = fs.statSync(latest);
    const ts    = stat.mtime.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
    logger.info(`/weekly: loaded ${latest} (${text.length} chars, updated ${ts})`);
    return text;
  } catch (err) {
    logger.error(`/weekly failed: ${err.message}`);
    return `❌ 週報讀取失敗：${err.message}`;
  }
}

function _findLatestWeeklyReport() {
  try {
    if (!fs.existsSync(WEEKLY_DIR)) return null;
    const txtFiles = fs.readdirSync(WEEKLY_DIR)
      .filter(f => f.endsWith('.txt'))
      .sort()
      .reverse();
    return txtFiles.length > 0 ? path.join(WEEKLY_DIR, txtFiles[0]) : null;
  } catch {
    return null;
  }
}

module.exports = { handle };
