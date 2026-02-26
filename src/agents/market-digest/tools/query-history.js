#!/usr/bin/env node
/**
 * query-history.js — 市場歷史數據 CLI 查詢工具
 *
 * 用法：
 *   node tools/query-history.js <SYMBOL> <period>
 *   node tools/query-history.js <SYMBOL> --from YYYY-MM-DD --to YYYY-MM-DD
 *   node tools/query-history.js --list
 *
 * 參數：
 *   SYMBOL   大寫指標名稱，如 SP500, NASDAQ, TAIEX, VIX, DXY, US10Y,
 *            GOLD, OIL_WTI, COPPER, BTC, USDTWD, FED_RATE, HY_SPREAD
 *   period   30d | 90d | 180d | 1y | all
 *
 * 選項：
 *   --format csv | json   輸出格式（預設 csv）
 *   --list                列出所有可用指標
 *   --stats               顯示統計摘要（count, mean, min, max, stddev）
 *
 * 範例：
 *   node tools/query-history.js SP500 90d
 *   node tools/query-history.js VIX --from 2024-01-01 --to 2024-12-31
 *   node tools/query-history.js SP500 1y --format json
 *   node tools/query-history.js SP500 90d --stats
 */

'use strict';

const path = require('path');

const DB_PATH = path.join(__dirname, '../data/market-history.db');

const COLUMNS = {
  SP500:     'sp500',
  NASDAQ:    'nasdaq',
  TAIEX:     'taiex',
  VIX:       'vix',
  DXY:       'dxy',
  US10Y:     'us10y',
  GOLD:      'gold',
  OIL_WTI:   'oil_wti',
  COPPER:    'copper',
  BTC:       'btc',
  USDTWD:    'usdtwd',
  FED_RATE:  'fed_rate',
  HY_SPREAD: 'hy_spread'
};

const CHANGE_COLS = {
  SP500:  'sp500_chg',
  NASDAQ: 'nasdaq_chg',
  TAIEX:  'taiex_chg',
  VIX:    'vix_chg'
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { symbol: null, from: null, to: null, format: 'csv', stats: false };

  if (args.includes('--list')) {
    console.log('可用指標：\n' + Object.keys(COLUMNS).join(', '));
    process.exit(0);
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from')   { opts.from   = args[++i]; continue; }
    if (args[i] === '--to')     { opts.to     = args[++i]; continue; }
    if (args[i] === '--format') { opts.format = args[++i]; continue; }
    if (args[i] === '--stats')  { opts.stats  = true;      continue; }
    if (!args[i].startsWith('-')) {
      if (!opts.symbol) {
        opts.symbol = args[i].toUpperCase();
      } else if (!opts.from && !opts.to) {
        // 解析 period（30d / 90d / 180d / 1y / all）
        const period = args[i];
        if (period !== 'all') {
          const match = period.match(/^(\d+)(d|y)$/);
          if (!match) { console.error(`無效的 period: ${period}`); process.exit(1); }
          const days = match[2] === 'y' ? parseInt(match[1]) * 365 : parseInt(match[1]);
          const to = new Date();
          const from = new Date(to);
          from.setDate(from.getDate() - days);
          opts.to   = to.toISOString().slice(0, 10);
          opts.from = from.toISOString().slice(0, 10);
        }
        // period === 'all' → from/to 保持 null，查詢全部
      }
    }
  }

  return opts;
}

function openDb() {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    console.error('錯誤：better-sqlite3 未安裝，請執行 npm install better-sqlite3');
    process.exit(1);
  }

  const fs = require('fs');
  if (!fs.existsSync(DB_PATH)) {
    console.error(`錯誤：找不到數據庫 ${DB_PATH}\n請先執行 Phase 4 或 tools/import-history.js 建立數據庫。`);
    process.exit(1);
  }

  return new Database(DB_PATH, { readonly: true });
}

function buildQuery(symbol, col, changeCol, from, to) {
  const conditions = [];
  if (from) conditions.push(`date >= '${from}'`);
  if (to)   conditions.push(`date <= '${to}'`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const changeSql = changeCol ? `, ${changeCol} AS change_pct` : ', NULL AS change_pct';
  return `SELECT date, ${col} AS value${changeSql}, source_quality FROM market_snapshots ${where} ORDER BY date ASC`;
}

function printCsv(rows, symbol) {
  console.log(`date,${symbol},change_pct,source_quality`);
  for (const r of rows) {
    const val = r.value != null ? r.value : '';
    const chg = r.change_pct != null ? r.change_pct.toFixed(4) : '';
    console.log(`${r.date},${val},${chg},${r.source_quality || ''}`);
  }
}

function printJson(rows, symbol) {
  const out = rows.map(r => ({
    date:           r.date,
    [symbol]:       r.value,
    change_pct:     r.change_pct,
    source_quality: r.source_quality
  }));
  console.log(JSON.stringify(out, null, 2));
}

function printStats(rows, symbol) {
  const vals = rows.map(r => r.value).filter(v => v != null);
  if (vals.length === 0) { console.log('無數據'); return; }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  const stddev = Math.sqrt(variance);
  console.log(`指標: ${symbol}`);
  console.log(`筆數: ${vals.length}`);
  console.log(`平均: ${mean.toFixed(4)}`);
  console.log(`最小: ${Math.min(...vals).toFixed(4)}`);
  console.log(`最大: ${Math.max(...vals).toFixed(4)}`);
  console.log(`標準差: ${stddev.toFixed(4)}`);
  console.log(`日期範圍: ${rows[0].date} ~ ${rows[rows.length - 1].date}`);
}

function main() {
  const opts = parseArgs();

  if (!opts.symbol) {
    console.error('用法：node tools/query-history.js <SYMBOL> <period|--from DATE --to DATE> [--format csv|json] [--stats]');
    console.error('可用指標：' + Object.keys(COLUMNS).join(', '));
    process.exit(1);
  }

  const col = COLUMNS[opts.symbol];
  if (!col) {
    console.error(`未知指標: ${opts.symbol}\n可用指標：${Object.keys(COLUMNS).join(', ')}`);
    process.exit(1);
  }

  const changeCol = CHANGE_COLS[opts.symbol] || null;
  const db = openDb();

  try {
    const sql = buildQuery(opts.symbol, col, changeCol, opts.from, opts.to);
    const rows = db.prepare(sql).all();

    if (rows.length === 0) {
      console.error(`無數據（日期範圍：${opts.from || '全部'} ~ ${opts.to || '全部'}）`);
      process.exit(0);
    }

    if (opts.stats) {
      printStats(rows, opts.symbol);
    } else if (opts.format === 'json') {
      printJson(rows, opts.symbol);
    } else {
      printCsv(rows, opts.symbol);
    }
  } finally {
    db.close();
  }
}

main();
