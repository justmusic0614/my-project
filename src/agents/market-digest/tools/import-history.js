#!/usr/bin/env node
/**
 * import-history.js — 歷史市場數據批次匯入工具
 *
 * 從付費 API 抓取指定日期範圍的歷史數據，寫入 SQLite（market-history.db）。
 * 適合一次性補入過去數年數據作為回測基礎。
 *
 * 用法：
 *   node tools/import-history.js --from 2022-01-01 --to 2026-02-21
 *   node tools/import-history.js --from 2022-01-01           # to 預設今天
 *   node tools/import-history.js --dry-run --from 2025-01-01 # 只顯示，不寫入
 *
 * 資料來源（優先順序）：
 *   FMP (付費)    → SP500, NASDAQ, VIX, DXY, US10Y, GOLD, OIL_WTI, COPPER
 *   Yahoo (免費)  → USDTWD, BTC；FMP 失敗時 fallback
 *   FRED (免費)   → FED_RATE, HY_SPREAD
 *   FinMind (付費) → TAIEX
 *
 * 配額估算（4 年歷史）：
 *   FMP: ~8 calls, Yahoo: ~2 calls, FRED: 2 calls, FinMind: 1 call（合計 ~13 calls）
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const path     = require('path');
const https    = require('https');
const { execSync } = require('child_process');

const DB_PATH = path.join(__dirname, '../data/market-history.db');

// ── API Keys ────────────────────────────────────────────────────────────────
const FMP_KEY     = process.env.FMP_API_KEY;
const FRED_KEY    = process.env.FRED_API_KEY;
const FINMIND_KEY = process.env.FINMIND_API_TOKEN;

// ── CLI 參數解析 ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    from:   null,
    to:     new Date().toISOString().slice(0, 10),
    dryRun: false
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from')    { opts.from   = args[++i]; continue; }
    if (args[i] === '--to')      { opts.to     = args[++i]; continue; }
    if (args[i] === '--dry-run') { opts.dryRun = true;      continue; }
  }
  if (!opts.from) {
    console.error('用法：node tools/import-history.js --from YYYY-MM-DD [--to YYYY-MM-DD] [--dry-run]');
    process.exit(1);
  }
  return opts;
}

// ── HTTP 工具 ─────────────────────────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketDigest/2.0)', ...headers }
    };
    const req = https.get(url, opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message} url=${url}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout: ${url}`)); });
  });
}

// FRED 專用：VPS 環境 Node.js https 無法連線 FRED，改用 curl
function curlGet(url) {
  try {
    const raw = execSync(`curl -s -m 30 "${url}"`, { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`curl failed: ${err.message}`);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── FMP 歷史數據 ─────────────────────────────────────────────────────────────
// /stable/historical-price-eod/full 回傳直接陣列 [{symbol, date, close, changePercent, ...}]
async function fetchFmpHistorical(symbol, from, to) {
  if (!FMP_KEY) { console.warn(`[FMP] FMP_API_KEY 未設定，跳過 ${symbol}`); return {}; }
  const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&apikey=${FMP_KEY}`;
  try {
    const json = await httpGet(url);
    // 直接陣列格式（非 {historical:[...]}），fields: date, close, changePercent
    const rows = Array.isArray(json) ? json : (json.historical || []);
    const result = {};
    for (const r of rows) {
      if (r.date && r.close != null) {
        result[r.date] = { close: r.close, changePct: r.changePercent ?? null };
      }
    }
    console.log(`[FMP] ${symbol}: ${Object.keys(result).length} 筆`);
    return result;
  } catch (err) {
    console.warn(`[FMP] ${symbol} 失敗: ${err.message}`);
    return {};
  }
}

// ── Yahoo Finance 歷史數據 ────────────────────────────────────────────────────
// /v8/finance/chart 回傳 timestamps + indicators.quote[0] {close[]}
async function fetchYahooHistorical(symbol, from, to) {
  const period1 = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
  const period2 = Math.floor(new Date(to   + 'T23:59:59Z').getTime() / 1000);
  // 使用 query1（比 query2 穩定），移除 crumb 空值（避免 400），加 Accept header
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  try {
    const json = await httpGet(url, { 'Accept': 'application/json' });
    const chart = json?.chart?.result?.[0];
    if (!chart) throw new Error('no chart result');
    const timestamps = chart.timestamp || [];
    const closes     = chart.indicators?.quote?.[0]?.close || [];
    const result = {};
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] == null) continue;
      const dateStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      result[dateStr] = { close: closes[i], changePct: null };
    }
    // 計算日變幅
    const dates = Object.keys(result).sort();
    for (let i = 1; i < dates.length; i++) {
      const prev = result[dates[i - 1]].close;
      const curr = result[dates[i]].close;
      if (prev) result[dates[i]].changePct = ((curr - prev) / prev) * 100;
    }
    console.log(`[Yahoo] ${symbol}: ${Object.keys(result).length} 筆`);
    return result;
  } catch (err) {
    console.warn(`[Yahoo] ${symbol} 失敗: ${err.message}`);
    return {};
  }
}

// ── FRED 歷史數據 ─────────────────────────────────────────────────────────────
// 注意：VPS 環境 Node.js https 無法連線 FRED，固定使用 curl
function fetchFredHistorical(seriesId, from, to) {
  if (!FRED_KEY) { console.warn(`[FRED] FRED_API_KEY 未設定，跳過 ${seriesId}`); return {}; }
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&observation_start=${from}&observation_end=${to}&api_key=${FRED_KEY}&file_type=json&limit=2000&sort_order=asc`;
  try {
    const json = curlGet(url);
    if (json.error_code) throw new Error(json.error_message);
    const result = {};
    for (const obs of (json.observations || [])) {
      const val = parseFloat(obs.value);
      if (!isNaN(val)) result[obs.date] = { close: val, changePct: null };
    }
    console.log(`[FRED] ${seriesId}: ${Object.keys(result).length} 筆`);
    return result;
  } catch (err) {
    console.warn(`[FRED] ${seriesId} 失敗: ${err.message}`);
    return {};
  }
}

// ── FinMind TAIEX ─────────────────────────────────────────────────────────────
async function fetchFinMindTaiex(from, to) {
  if (!FINMIND_KEY) { console.warn('[FinMind] FINMIND_API_TOKEN 未設定，跳過 TAIEX'); return {}; }
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTotalReturnIndex&data_id=IR0001&start_date=${from}&end_date=${to}&token=${FINMIND_KEY}`;
  try {
    const json = await httpGet(url);
    if (json.status !== 200) throw new Error(json.msg || 'FinMind error');
    const result = {};
    const rows = json.data || [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const date = r.date?.slice(0, 10);
      if (!date || r.price == null) continue;
      const prev = i > 0 ? rows[i - 1].price : null;
      result[date] = {
        close:    r.price,
        changePct: prev ? ((r.price - prev) / prev) * 100 : null
      };
    }
    console.log(`[FinMind] TAIEX: ${Object.keys(result).length} 筆`);
    return result;
  } catch (err) {
    console.warn(`[FinMind] TAIEX 失敗: ${err.message}`);
    return {};
  }
}

// ── SQLite 寫入 ───────────────────────────────────────────────────────────────
function openDb() {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      date       TEXT PRIMARY KEY,
      sp500      REAL, nasdaq    REAL, taiex    REAL,
      vix        REAL, dxy       REAL, us10y    REAL,
      gold       REAL, oil_wti   REAL, copper   REAL,
      btc        REAL, usdtwd    REAL,
      fed_rate   REAL, hy_spread REAL,
      sp500_chg  REAL, nasdaq_chg REAL, taiex_chg REAL, vix_chg REAL,
      source_quality TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_date ON market_snapshots(date);
  `);
  return db;
}

function calcQuality(row) {
  const missing = [row.sp500, row.nasdaq, row.taiex, row.vix]
    .filter(v => v == null).length;
  if (missing === 0) return 'full';
  if (missing <= 1) return 'partial';
  return 'degraded';
}

// ── 主程式 ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  console.log(`\n=== 歷史數據匯入 ${opts.from} ~ ${opts.to} ===`);
  if (opts.dryRun) console.log('[DRY RUN] 只顯示，不寫入 DB\n');

  // 1. 抓取各來源（逐一，避免並發觸發 rate limit）
  console.log('\n[1/5] FMP 美股指數...');
  const fmpSp500  = await fetchFmpHistorical('^GSPC',    opts.from, opts.to); await sleep(300);
  const fmpNasdaq = await fetchFmpHistorical('^IXIC',    opts.from, opts.to); await sleep(300);
  const fmpVix    = await fetchFmpHistorical('^VIX',     opts.from, opts.to); await sleep(300);
  const fmpDxy    = await fetchFmpHistorical('DX-Y.NYB', opts.from, opts.to); await sleep(300);
  const fmpUs10y  = await fetchFmpHistorical('TNX',      opts.from, opts.to); await sleep(300); // FMP 無 ^ 前綴
  const fmpGold   = await fetchFmpHistorical('GC=F',     opts.from, opts.to); await sleep(300);
  const fmpOil    = await fetchFmpHistorical('CL=F',     opts.from, opts.to); await sleep(300);
  const fmpCopper = await fetchFmpHistorical('HG=F',     opts.from, opts.to); await sleep(300);

  console.log('\n[2/5] Yahoo Finance（USDTWD, BTC + FMP fallback）...');
  const yahooBtc    = await fetchYahooHistorical('BTC-USD',   opts.from, opts.to); await sleep(500);
  const yahooUsdtwd = await fetchYahooHistorical('USDTWD=X',  opts.from, opts.to); await sleep(500);
  // Fallback：若 FMP 空，用 Yahoo
  const yahooSp500  = Object.keys(fmpSp500).length  === 0 ? await fetchYahooHistorical('^GSPC',    opts.from, opts.to) : {};
  const yahooNasdaq = Object.keys(fmpNasdaq).length === 0 ? await fetchYahooHistorical('^IXIC',    opts.from, opts.to) : {};
  const yahooVix    = Object.keys(fmpVix).length    === 0 ? await fetchYahooHistorical('^VIX',     opts.from, opts.to) : {};
  const yahooDxy    = Object.keys(fmpDxy).length    === 0 ? await fetchYahooHistorical('DX-Y.NYB', opts.from, opts.to) : {};
  const yahooUs10y  = Object.keys(fmpUs10y).length  === 0 ? await fetchYahooHistorical('^TNX',     opts.from, opts.to) : {};

  console.log('\n[3/5] FRED 利率數據...');
  const fredFedRate  = fetchFredHistorical('FEDFUNDS',     opts.from, opts.to); await sleep(300);
  const fredHySpread = fetchFredHistorical('BAMLH0A0HYM2', opts.from, opts.to); await sleep(300);

  console.log('\n[4/5] FinMind TAIEX...');
  const finmindTaiex = await fetchFinMindTaiex(opts.from, opts.to);

  // 2. 合併：以 FMP SP500 日期集合為美股交易日基準
  console.log('\n[5/5] 合併並寫入 SQLite...');
  const sp500Dates  = new Set(Object.keys(fmpSp500).length  ? Object.keys(fmpSp500)  : Object.keys(yahooSp500));
  const taiexDates  = new Set(Object.keys(finmindTaiex));
  const allDates    = new Set([...sp500Dates, ...taiexDates]);
  const sortedDates = [...allDates].sort();

  if (sortedDates.length === 0) {
    console.error('未取得任何數據，請確認 API key 和日期範圍。');
    process.exit(1);
  }

  const rows = sortedDates.map(date => {
    const sp500   = fmpSp500[date]  || yahooSp500[date]  || null;
    const nasdaq  = fmpNasdaq[date] || yahooNasdaq[date] || null;
    const vix     = fmpVix[date]    || yahooVix[date]    || null;
    const dxy     = fmpDxy[date]    || yahooDxy[date]    || null;
    const us10y   = fmpUs10y[date]  || yahooUs10y[date]  || null;
    const gold    = fmpGold[date]   || null;
    const oilWti  = fmpOil[date]    || null;
    const copper  = fmpCopper[date] || null;
    const btc     = yahooBtc[date]  || null;
    const usdtwd  = yahooUsdtwd[date] || null;
    const taiex   = finmindTaiex[date] || null;

    // FRED：以最近的有效值填充（FRED 月度/週度數據按日期向前填充）
    const fredDatesBefore = d => Object.keys(fredFedRate).filter(k => k <= d).sort().pop();
    const fredHyDatesBefore = d => Object.keys(fredHySpread).filter(k => k <= d).sort().pop();
    const fedRateKey  = fredDatesBefore(date);
    const hySpreadKey = fredHyDatesBefore(date);

    return {
      date,
      sp500:     sp500?.close   ?? null,
      nasdaq:    nasdaq?.close  ?? null,
      taiex:     taiex?.close   ?? null,
      vix:       vix?.close     ?? null,
      dxy:       dxy?.close     ?? null,
      us10y:     us10y?.close   ?? null,
      gold:      gold?.close    ?? null,
      oil_wti:   oilWti?.close  ?? null,
      copper:    copper?.close  ?? null,
      btc:       btc?.close     ?? null,
      usdtwd:    usdtwd?.close  ?? null,
      fed_rate:  fedRateKey  ? fredFedRate[fedRateKey].close  : null,
      hy_spread: hySpreadKey ? fredHySpread[hySpreadKey].close : null,
      sp500_chg:  sp500?.changePct  ?? null,
      nasdaq_chg: nasdaq?.changePct ?? null,
      taiex_chg:  taiex?.changePct  ?? null,
      vix_chg:    vix?.changePct    ?? null
    };
  });

  if (opts.dryRun) {
    console.log(`\n[DRY RUN] 預覽前 5 筆：`);
    console.table(rows.slice(0, 5).map(r => ({
      date: r.date, sp500: r.sp500, nasdaq: r.nasdaq, taiex: r.taiex, vix: r.vix
    })));
    console.log(`\n共 ${rows.length} 筆（不寫入）`);
    return;
  }

  // 寫入 SQLite
  const db = openDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO market_snapshots
      (date, sp500, nasdaq, taiex, vix, dxy, us10y,
       gold, oil_wti, copper, btc, usdtwd, fed_rate, hy_spread,
       sp500_chg, nasdaq_chg, taiex_chg, vix_chg,
       source_quality, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(rows => {
    for (const r of rows) {
      stmt.run(
        r.date, r.sp500, r.nasdaq, r.taiex, r.vix, r.dxy, r.us10y,
        r.gold, r.oil_wti, r.copper, r.btc, r.usdtwd, r.fed_rate, r.hy_spread,
        r.sp500_chg, r.nasdaq_chg, r.taiex_chg, r.vix_chg,
        calcQuality(r), new Date().toISOString()
      );
    }
  });

  insertMany(rows);
  db.close();

  const fullCount = rows.filter(r => calcQuality(r) === 'full').length;
  console.log(`\n✅ 匯入完成：${rows.length} 筆（full: ${fullCount}, partial/degraded: ${rows.length - fullCount}）`);
  console.log(`   日期範圍：${rows[0].date} ~ ${rows[rows.length - 1].date}`);
  console.log(`   數據庫：${DB_PATH}`);
}

main().catch(err => {
  console.error('匯入失敗：', err.message);
  process.exit(1);
});
