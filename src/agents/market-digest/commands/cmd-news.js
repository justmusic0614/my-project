/**
 * /news [關鍵字] — 今日財經新聞 / 關鍵字搜尋 / 突發事件
 * 用法：
 *   /news              今日所有重要新聞（P0+P1）
 *   /news 台積電       搜尋含「台積電」的新聞
 *   /突發              最近 24h P0 重大新聞
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');

const logger = createLogger('cmd:news');

const STATE_FILE = path.join(__dirname, '../data/pipeline-state/phase3-result.json');
const MAX_ITEMS  = 10;

async function handle(args, config = {}, context = {}) {
  // 判斷是否為 /突發 模式（由 command-router 傳入 isBreaking context）
  const isBreaking = context.isBreaking || args[0] === '--breaking';
  const keyword    = isBreaking ? null : args.join(' ').trim() || null;

  logger.info('/news executing', { keyword, isBreaking });

  const phase3 = _loadPhase3();
  if (!phase3) {
    return '⏳ 今日新聞尚未就緒（等候 07:45 收集完成後再查詢）';
  }

  const news = phase3.uniqueNews || phase3.aiResult?.rankedNews || [];
  if (news.length === 0) {
    return '📰 今日無新聞數據';
  }

  if (isBreaking) {
    return _formatBreaking(news, phase3.date);
  } else if (keyword) {
    return _formatSearch(news, keyword, phase3.date);
  } else {
    return _formatToday(news, phase3.date);
  }
}

/**
 * /news — 今日重要新聞（P0+P1）
 */
function _formatToday(news, date) {
  const important = news.filter(n => n.importance === 'P0' || n.importance === 'P1');
  const other     = news.filter(n => n.importance === 'P2').slice(0, 3);

  const lines = [`📰 今日財經新聞 ${date || ''}`, ''];

  if (important.length > 0) {
    lines.push('🔴 重要事件（P0/P1）');
    important.slice(0, MAX_ITEMS).forEach(n => {
      const badge = n.importance === 'P0' ? '❗' : '📌';
      const ts    = _fmtTime(n.publishedAt);
      lines.push(`${badge} ${n.title}${n.aiSummary ? `（${n.aiSummary}）` : ''}${ts ? ` [${ts}]` : ''}`);
    });
  }

  if (other.length > 0) {
    lines.push('');
    lines.push('📋 其他市場訊息');
    other.forEach(n => lines.push(`• ${n.title}`));
  }

  if (important.length === 0 && other.length === 0) {
    lines.push('今日無重要新聞');
  }

  lines.push('', `共 ${news.length} 則新聞 | 使用 /news <關鍵字> 搜尋`);
  return lines.join('\n');
}

/**
 * /突發 — P0 重大事件
 */
function _formatBreaking(news, date) {
  const breaking = news.filter(n => n.importance === 'P0');
  if (breaking.length === 0) {
    return `🟢 ${date || '今日'} 無重大突發事件`;
  }

  const lines = ['🚨 重大事件（P0）', ''];
  breaking.slice(0, 5).forEach((n, i) => {
    const ts = _fmtTime(n.publishedAt);
    lines.push(`${i + 1}. ${n.title}`);
    if (n.aiSummary) lines.push(`   ${n.aiSummary}`);
    if (ts) lines.push(`   ${ts} | ${n.source}`);
  });
  return lines.join('\n');
}

/**
 * /news <關鍵字> — 關鍵字搜尋
 */
function _formatSearch(news, keyword, date) {
  const lower   = keyword.toLowerCase();
  const matched = news.filter(n => {
    const text = `${n.title} ${n.summary || ''}`.toLowerCase();
    return text.includes(lower);
  });

  if (matched.length === 0) {
    return `🔍 「${keyword}」沒有相關新聞\n💡 試試其他關鍵字或查看 /news`;
  }

  const lines = [`🔍 「${keyword}」相關新聞 ${date || ''}`, ''];
  matched.slice(0, MAX_ITEMS).forEach((n, i) => {
    const ts = _fmtTime(n.publishedAt);
    lines.push(`${i + 1}. [${n.importance}] ${n.title}${ts ? ` [${ts}]` : ''}`);
    if (n.summary) lines.push(`   ${n.summary.slice(0, 80)}`);
  });
  lines.push('', `找到 ${matched.length} 則相關新聞`);
  return lines.join('\n');
}

function _loadPhase3() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function _fmtTime(isoDate) {
  if (!isoDate) return '';
  try {
    return new Date(isoDate).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

module.exports = { handle };
