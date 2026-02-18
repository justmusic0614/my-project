/**
 * /query <關鍵字> [--days N] — 搜尋歷史日報
 * 功能：在 daily-brief/ 存檔的 TXT 中搜尋關鍵字（最近 N 天）
 *
 * 用法：
 *   /query 台積電
 *   /query Fed --days 14
 *   /query FOMC --days 30
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');

const logger = createLogger('cmd:query');

const DAILY_DIR   = path.join(__dirname, '../data/daily-brief');
const DEFAULT_DAYS = 7;
const MAX_DAYS     = 30;
const MAX_RESULTS  = 5;

async function handle(args, config = {}) {
  // 解析關鍵字和 --days
  const daysIdx = args.indexOf('--days');
  const days    = daysIdx !== -1 ? Math.min(parseInt(args[daysIdx + 1] || DEFAULT_DAYS, 10) || DEFAULT_DAYS, MAX_DAYS) : DEFAULT_DAYS;
  const keywordArgs = args.filter((a, i) => a !== '--days' && i !== daysIdx + 1);
  const keyword     = keywordArgs.join(' ').trim();

  if (!keyword) {
    return '❌ 請指定搜尋關鍵字\n💡 例如：/query 台積電 或 /query Fed --days 14';
  }

  logger.info(`/query "${keyword}" --days ${days}`);

  if (!fs.existsSync(DAILY_DIR)) {
    return '📂 尚無歷史日報存檔（首次使用需等待 pipeline 執行後產生）';
  }

  // 取得最近 N 天的日報文件
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const files = fs.readdirSync(DAILY_DIR)
    .filter(f => f.endsWith('.txt'))
    .filter(f => {
      const dateStr = f.replace('.txt', '');
      return new Date(dateStr) >= cutoff;
    })
    .sort()
    .reverse();

  if (files.length === 0) {
    return `📂 最近 ${days} 天無日報存檔`;
  }

  // 搜尋關鍵字
  const lower   = keyword.toLowerCase();
  const matches = [];

  for (const file of files) {
    if (matches.length >= MAX_RESULTS) break;
    try {
      const content = fs.readFileSync(path.join(DAILY_DIR, file), 'utf8');
      if (content.toLowerCase().includes(lower)) {
        const date    = file.replace('.txt', '');
        const snippet = _extractSnippet(content, keyword);
        matches.push({ date, snippet });
      }
    } catch {}
  }

  if (matches.length === 0) {
    return `🔍 最近 ${days} 天日報中未找到「${keyword}」\n搜尋範圍：${files.length} 份日報`;
  }

  const lines = [`🔍 「${keyword}」搜尋結果（最近 ${days} 天）`, ''];
  matches.forEach(({ date, snippet }, i) => {
    lines.push(`📅 ${date}`);
    lines.push(`  ${snippet}`);
    if (i < matches.length - 1) lines.push('');
  });
  lines.push('', `找到 ${matches.length} 份相關日報（搜尋 ${files.length} 份）`);

  return lines.join('\n');
}

/**
 * 提取包含關鍵字的片段（前後各 60 字元）
 */
function _extractSnippet(content, keyword) {
  const lower = keyword.toLowerCase();
  const idx   = content.toLowerCase().indexOf(lower);
  if (idx === -1) return '';

  const start   = Math.max(0, idx - 60);
  const end     = Math.min(content.length, idx + keyword.length + 60);
  let   snippet = content.slice(start, end).replace(/\n+/g, ' ').trim();

  if (start > 0)               snippet = '...' + snippet;
  if (end < content.length)    snippet = snippet + '...';

  // 高亮關鍵字（用 ** 標記）
  const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  snippet = snippet.replace(re, match => `*${match}*`);

  return snippet;
}

module.exports = { handle };
