/**
 * /watchlist — Watchlist 管理命令
 *
 * 子命令：
 *   /watchlist list              列出目前追蹤清單
 *   /watchlist add 2330 0050     新增股票代號
 *   /watchlist remove 2330       移除股票代號
 *   /watchlist clear             清空追蹤清單（確認後執行）
 *
 * 儲存格式：data/watchlist.json
 * [{ "symbol": "2330", "name": "台積電", "addedAt": "..." }, ...]
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const { loadWatchlist } = require('../shared/watchlist-loader');

const logger = createLogger('cmd:watchlist');

const WATCHLIST_FILE = path.join(__dirname, '../data/watchlist.json');
const MAX_SYMBOLS    = 30;

async function handle(args, config = {}) {
  const subCmd = args[0]?.toLowerCase() || 'list';

  switch (subCmd) {
    case 'list':   return _list();
    case 'add':    return _add(args.slice(1));
    case 'remove':
    case 'rm':     return _remove(args.slice(1));
    case 'clear':  return _clear();
    default:
      return `❌ 未知子命令：${subCmd}\n💡 可用：list | add <代號> | remove <代號> | clear`;
  }
}

function _list() {
  const wl = _load();
  if (wl.length === 0) {
    return '📋 Watchlist 目前為空\n💡 使用 /watchlist add 2330 新增股票';
  }
  const lines = ['📋 Watchlist（目前追蹤）', ''];
  wl.forEach((item, i) => {
    const ts = item.addedAt ? new Date(item.addedAt).toLocaleDateString('zh-TW') : '';
    lines.push(`${i + 1}. ${item.symbol}${item.name ? ` ${item.name}` : ''}${ts ? ` (${ts})` : ''}`);
  });
  lines.push('', `共 ${wl.length}/${MAX_SYMBOLS} 支`);
  return lines.join('\n');
}

function _add(symbols) {
  if (symbols.length === 0) {
    return '❌ 請指定股票代號\n💡 例如：/watchlist add 2330 0050';
  }

  const wl      = _load();
  const added   = [];
  const skipped = [];

  for (const sym of symbols) {
    const upper = sym.toUpperCase();
    if (wl.some(item => item.symbol === upper)) {
      skipped.push(upper);
    } else if (wl.length >= MAX_SYMBOLS) {
      return `❌ Watchlist 已達上限 ${MAX_SYMBOLS} 支，請先移除部分股票`;
    } else {
      wl.push({ symbol: upper, name: '', addedAt: new Date().toISOString() });
      added.push(upper);
    }
  }

  _save(wl);

  const lines = [];
  if (added.length > 0)   lines.push(`✅ 已新增：${added.join(', ')}`);
  if (skipped.length > 0) lines.push(`⏭ 已存在（跳過）：${skipped.join(', ')}`);
  lines.push(`📋 目前共 ${wl.length} 支`);
  return lines.join('\n');
}

function _remove(symbols) {
  if (symbols.length === 0) {
    return '❌ 請指定股票代號\n💡 例如：/watchlist remove 2330';
  }

  let wl      = _load();
  const removed = [];
  const notFound = [];

  for (const sym of symbols) {
    const upper = sym.toUpperCase();
    const before = wl.length;
    wl = wl.filter(item => item.symbol !== upper);
    if (wl.length < before) removed.push(upper);
    else notFound.push(upper);
  }

  _save(wl);

  const lines = [];
  if (removed.length > 0)  lines.push(`✅ 已移除：${removed.join(', ')}`);
  if (notFound.length > 0) lines.push(`❓ 找不到：${notFound.join(', ')}`);
  lines.push(`📋 剩餘 ${wl.length} 支`);
  return lines.join('\n');
}

function _clear() {
  _save([]);
  return '✅ Watchlist 已清空';
}

function _load() {
  _ensureDir();
  return loadWatchlist(WATCHLIST_FILE);
}

function _save(wl) {
  _ensureDir();
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(wl, null, 2), 'utf8');
}

function _ensureDir() {
  const dir = path.dirname(WATCHLIST_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { handle };
