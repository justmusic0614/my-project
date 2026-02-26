/**
 * /financial — Watchlist 財報 + 籌碼分析
 * 功能：讀取 phase3-result 中 watchlist 相關數據，產生 Watchlist 聚焦報告
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const { loadWatchlist } = require('../shared/watchlist-loader');

const logger = createLogger('cmd:financial');

const STATE_FILE     = path.join(__dirname, '../data/pipeline-state/phase3-result.json');
const WATCHLIST_FILE = path.join(__dirname, '../data/watchlist.json');

async function handle(args, config = {}) {
  logger.info('/financial executing');

  const watchlist = loadWatchlist(WATCHLIST_FILE);
  if (watchlist.length === 0) {
    return '📋 Watchlist 為空\n💡 使用 /watchlist add <代號> 新增追蹤股票';
  }

  const phase3 = _loadPhase3();
  if (!phase3) {
    return '⏳ 今日數據尚未就緒，請等候 08:00 日報生成後再查詢';
  }

  const lines = [];
  lines.push(`💹 Watchlist 財務聚焦 ${_today()}`);
  lines.push('');

  const prices  = phase3.institutionalData?.tw50Prices || {};
  const instData = phase3.institutionalData || {};

  for (const item of watchlist.slice(0, 15)) {
    const sym   = item.symbol;
    const price = prices[sym];
    const name  = item.name || sym;

    let line = `• ${sym} ${name}`;
    if (price) {
      const arrow = (price.changePct ?? 0) >= 0 ? '▲' : '▼';
      const sign  = (price.changePct ?? 0) >= 0 ? '+' : '';
      line += ` ${price.close} ${arrow}${sign}${(price.changePct || 0).toFixed(2)}%`;

      // 外資籌碼
      if (price.foreignNet != null) {
        const lots   = Math.abs(Math.round(price.foreignNet / 1000));
        const action = price.foreignNet >= 0 ? '外資買超' : '外資賣超';
        line += ` | ${action} ${lots.toLocaleString()}張`;
      }
    } else {
      line += ' [無報價數據]';
    }

    lines.push(line);
  }

  // 整體法人摘要
  lines.push('');
  lines.push('📊 三大法人整體');
  if (instData.foreign != null) {
    const action = instData.foreign >= 0 ? '買超' : '賣超';
    lines.push(`  外資：${action} ${Math.abs(Math.round(instData.foreign / 1e8)).toLocaleString()} 億`);
  }
  if (instData.trust != null) {
    const action = instData.trust >= 0 ? '買超' : '賣超';
    lines.push(`  投信：${action} ${Math.abs(Math.round(instData.trust / 1e8)).toLocaleString()} 億`);
  }
  if (instData.dealer != null) {
    const action = instData.dealer >= 0 ? '買超' : '賣超';
    lines.push(`  自營：${action} ${Math.abs(Math.round(instData.dealer / 1e8)).toLocaleString()} 億`);
  }

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

function _today() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = { handle };
