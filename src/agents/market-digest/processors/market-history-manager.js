/**
 * Market History Manager — 市場歷史資料管理
 *
 * 功能：
 * - 儲存每日市場資料（VIX, US10Y, DXY, Put/Call Ratio, SPY Volume）
 * - 計算移動平均（5日、10日、20日）
 * - 自動保留最近 30 天資料
 *
 * 資料儲存位置：data/market-history/*.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../shared/logger');

const logger = createLogger('processor:market-history');

class MarketHistoryManager {
  constructor(dataDir = null) {
    this.dataDir = dataDir || path.join(__dirname, '../data/market-history');
    this.ensureDataDir();
  }

  /**
   * 確保資料目錄存在
   */
  ensureDataDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info(`created market-history directory: ${this.dataDir}`);
    }
  }

  /**
   * 更新歷史資料並計算移動平均
   * @param {string} date - 日期（YYYY-MM-DD）
   * @param {object} marketData - 當日市場資料
   * @returns {Promise<object>} - 包含移動平均的歷史統計
   */
  async updateHistory(date, marketData) {
    const history = {
      vix:          await this._updateSeries('vix',          date, marketData.VIX?.value),
      us10y:        await this._updateSeries('us10y',        date, marketData.US10Y?.value),
      dxy:          await this._updateSeries('dxy',          date, marketData.DXY?.value),
      sp500:        await this._updateSeries('sp500',        date, marketData.SP500?.value),
      nasdaq:       await this._updateSeries('nasdaq',       date, marketData.NASDAQ?.value),
      taiex:        await this._updateSeries('taiex',        date, marketData.TAIEX?.value),
      gold:         await this._updateSeries('gold',         date, marketData.GOLD?.value),
      btc:          await this._updateSeries('btc',          date, marketData.BTC?.value),
      fedRate:      await this._updateSeries('fed-rate',     date, marketData.FED_RATE?.value),
      hySpread:     await this._updateSeries('hy-spread',    date, marketData.HY_SPREAD?.value),
      putCallRatio: await this._updateSeries('put-call-ratio', date, marketData.PUT_CALL_RATIO?.value),
      spyVolume:    await this._updateSeries('spy-volume',   date, marketData.SPY_VOLUME?.current)
    };

    return this._calculateMovingAverages(history);
  }

  /**
   * 更新單一時間序列
   * @param {string} seriesName - 序列名稱（如 'vix', 'us10y'）
   * @param {string} date - 日期（YYYY-MM-DD）
   * @param {number|null} value - 資料值
   * @returns {Promise<Array|null>} - 歷史資料陣列
   */
  async _updateSeries(seriesName, date, value) {
    if (value == null) return null;

    const filePath = path.join(this.dataDir, `${seriesName}.json`);
    let data = [];

    // 讀取現有資料
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        data = JSON.parse(content);
      } catch (err) {
        logger.warn(`failed to read ${seriesName}.json: ${err.message}, resetting`);
        data = [];
      }
    }

    // 檢查是否已存在當日資料（更新而非重複新增）
    const existingIndex = data.findIndex(d => d.date === date);
    if (existingIndex >= 0) {
      data[existingIndex].value = value;
      logger.info(`updated ${seriesName} for ${date}: ${value}`);
    } else {
      data.push({ date, value });
      logger.info(`added ${seriesName} for ${date}: ${value}`);
    }

    // 保留最近 365 天
    if (data.length > 365) {
      data = data.slice(-365);
    }

    // 寫回檔案
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      logger.error(`failed to write ${seriesName}.json: ${err.message}`);
    }

    return data;
  }

  /**
   * 計算移動平均
   * @param {object} history - 各序列的歷史資料
   * @returns {object} - 包含當前值和移動平均的統計
   */
  _calculateMovingAverages(history) {
    const result = {};

    // VIX：當前值 + 5日/10日均線
    if (history.vix?.length > 0) {
      result.vix = {
        current:  history.vix[history.vix.length - 1].value,
        avg5Day:  this._calculateMA(history.vix, 5),
        avg10Day: this._calculateMA(history.vix, 10)
      };
    }

    // US10Y：當前值 + 5日均線
    if (history.us10y?.length > 0) {
      result.us10y = {
        current: history.us10y[history.us10y.length - 1].value,
        avg5Day: this._calculateMA(history.us10y, 5)
      };
    }

    // DXY：當前值 + 5日均線
    if (history.dxy?.length > 0) {
      result.dxy = {
        current: history.dxy[history.dxy.length - 1].value,
        avg5Day: this._calculateMA(history.dxy, 5)
      };
    }

    // SP500：當前值 + 5日/20日均線
    if (history.sp500?.length > 0) {
      result.sp500 = {
        current:  history.sp500[history.sp500.length - 1].value,
        avg5Day:  this._calculateMA(history.sp500, 5),
        avg20Day: this._calculateMA(history.sp500, 20)
      };
    }

    // NASDAQ：當前值 + 5日/20日均線
    if (history.nasdaq?.length > 0) {
      result.nasdaq = {
        current:  history.nasdaq[history.nasdaq.length - 1].value,
        avg5Day:  this._calculateMA(history.nasdaq, 5),
        avg20Day: this._calculateMA(history.nasdaq, 20)
      };
    }

    // TAIEX：當前值 + 5日均線
    if (history.taiex?.length > 0) {
      result.taiex = {
        current: history.taiex[history.taiex.length - 1].value,
        avg5Day: this._calculateMA(history.taiex, 5)
      };
    }

    // GOLD：當前值 + 5日/20日均線
    if (history.gold?.length > 0) {
      result.gold = {
        current:  history.gold[history.gold.length - 1].value,
        avg5Day:  this._calculateMA(history.gold, 5),
        avg20Day: this._calculateMA(history.gold, 20)
      };
    }

    // BTC：當前值 + 7日均線
    if (history.btc?.length > 0) {
      result.btc = {
        current: history.btc[history.btc.length - 1].value,
        avg7Day: this._calculateMA(history.btc, 7)
      };
    }

    // Fed Rate：只記當前值
    if (history.fedRate?.length > 0) {
      result.fedRate = { current: history.fedRate[history.fedRate.length - 1].value };
    }

    // HY Spread：當前值 + 5日均線 + 5日變化
    if (history.hySpread?.length > 0) {
      const current = history.hySpread[history.hySpread.length - 1].value;
      const avg5Day = this._calculateMA(history.hySpread, 5);
      let change5d = null;
      if (history.hySpread.length >= 6) {
        const prev5 = history.hySpread[history.hySpread.length - 6].value;
        change5d = current - prev5;
      }
      result.hySpread = { current, avg5Day, change5d };
    }

    // Put/Call Ratio：當前值 + 10日均線
    if (history.putCallRatio?.length > 0) {
      result.putCallRatio = {
        current:  history.putCallRatio[history.putCallRatio.length - 1].value,
        avg10Day: this._calculateMA(history.putCallRatio, 10)
      };
    }

    // SPY Volume：當前值 + 20日均線
    if (history.spyVolume?.length > 0) {
      result.spyVolume = {
        current:  history.spyVolume[history.spyVolume.length - 1].value,
        avg20Day: this._calculateMA(history.spyVolume, 20)
      };
    }

    return result;
  }

  /**
   * 計算移動平均
   * @param {Array} data - 歷史資料陣列 [{ date, value }, ...]
   * @param {number} period - 期間（天數）
   * @returns {number} - 移動平均值
   */
  _calculateMA(data, period) {
    if (data.length < period) {
      // 資料不足期間，使用當前值
      return data[data.length - 1].value;
    }
    const slice = data.slice(-period);
    const sum = slice.reduce((acc, item) => acc + item.value, 0);
    return sum / period;
  }

  /**
   * 讀取特定序列的歷史資料
   * @param {string} seriesName - 序列名稱
   * @returns {Array} - 歷史資料陣列
   */
  getSeriesHistory(seriesName) {
    const filePath = path.join(this.dataDir, `${seriesName}.json`);
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      logger.error(`failed to read ${seriesName}.json: ${err.message}`);
      return [];
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SQLite 後端方法（Weekly Tactical Setup 用）
  // ══════════════════════════════════════════════════════════════════════════

  /** getHistory() 允許的欄位白名單（防 SQL injection） */
  static COLUMN_WHITELIST = new Set([
    'sp500', 'nasdaq', 'taiex', 'vix', 'dxy', 'us10y',
    'hy_spread', 'gold', 'oil_wti', 'copper',
    'spy', 'rsp', 'qqq'
  ]);

  /** marketData key → DB column 映射 */
  static MARKET_DATA_MAP = {
    SP500: 'sp500', NASDAQ: 'nasdaq', TAIEX: 'taiex',
    VIX: 'vix', DXY: 'dxy', US10Y: 'us10y',
    GOLD: 'gold', OIL_WTI: 'oil_wti', COPPER: 'copper',
    BTC: 'btc', USDTWD: 'usdtwd',
    FED_RATE: 'fed_rate', HY_SPREAD: 'hy_spread'
  };

  /**
   * 懶初始化 SQLite 連線（singleton）
   * - DB 不存在 → 自動 CREATE TABLE + CREATE INDEX
   * - 啟用 WAL 模式
   * - 檢查並新增 spy/rsp/qqq 欄位
   */
  _openDb() {
    if (this._db) return this._db;

    let Database;
    try {
      Database = require('better-sqlite3');
    } catch {
      logger.error('better-sqlite3 not installed');
      throw new Error('better-sqlite3 not installed');
    }

    const dbPath = path.join(__dirname, '../data/market-history.db');
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');

    // 自動建表（同 import-history.js schema）
    this._db.exec(`
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

    this._ensureColumns();
    logger.info('SQLite DB opened (WAL mode)', { path: dbPath });
    return this._db;
  }

  /**
   * 檢查並新增 spy/rsp/qqq 欄位（migration）
   */
  _ensureColumns() {
    const db = this._db;
    const info = db.pragma('table_info(market_snapshots)');
    const existingCols = new Set(info.map(c => c.name));

    for (const col of ['spy', 'rsp', 'qqq']) {
      if (!existingCols.has(col)) {
        db.exec(`ALTER TABLE market_snapshots ADD COLUMN ${col} REAL`);
        logger.info(`Added column '${col}' to market_snapshots`);
      }
    }
  }

  /**
   * 每日寫入（phase3 呼叫）
   * INSERT OR IGNORE — append-only，已存在就跳過
   * @param {string} date - YYYY-MM-DD
   * @param {object} marketData - 驗證後的市場資料
   */
  appendDailySnapshot(date, marketData) {
    const db = this._openDb();

    const row = { date, created_at: new Date().toISOString() };
    const chgKeys = { SP500: 'sp500_chg', NASDAQ: 'nasdaq_chg', TAIEX: 'taiex_chg', VIX: 'vix_chg' };

    // 映射欄位值
    for (const [mKey, dbCol] of Object.entries(MarketHistoryManager.MARKET_DATA_MAP)) {
      const dp = marketData[mKey];
      row[dbCol] = dp?.value != null ? dp.value : null;
    }

    // 映射 change 值
    for (const [mKey, dbCol] of Object.entries(chgKeys)) {
      const dp = marketData[mKey];
      row[dbCol] = dp?.changePct != null ? dp.changePct : null;
    }

    // TAIEX 合理性 guard（10,000 - 40,000 為正常加權指數範圍）
    // 排除 TaiwanStockTotalReturnIndex 報酬指數（現值 ~70,000-80,000）等異常值
    if (row.taiex != null && (row.taiex < 10000 || row.taiex > 40000)) {
      logger.warn(`appendDailySnapshot: TAIEX value ${row.taiex} out of reasonable range [10000-40000], setting to NULL`);
      row.taiex = null;
    }

    // 計算 source_quality
    const missing = [row.sp500, row.nasdaq, row.taiex, row.vix].filter(v => v == null).length;
    row.source_quality = missing === 0 ? 'full' : missing <= 1 ? 'partial' : 'degraded';

    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT OR IGNORE INTO market_snapshots (${cols.join(', ')}) VALUES (${placeholders})`;

    const stmt = db.prepare(sql);
    const result = stmt.run(...cols.map(c => row[c]));

    if (result.changes > 0) {
      logger.info(`SQLite appendDailySnapshot: ${date} (${row.source_quality})`);
    } else {
      logger.info(`SQLite appendDailySnapshot: ${date} already exists, skipped`);
    }
  }

  /**
   * 批次寫入（週日 pipeline 呼叫，填充 SPY/RSP/QQQ）
   * 使用 transaction 包起來（效能 + ACID）
   * 三路邏輯：INSERT / UPDATE(NULL) / warn(值不同)
   * @param {string} column - 目標欄位（必須在白名單中）
   * @param {Array<{date:string, close:number}>} ohlcvData - 歷史資料
   * @returns {{ inserted: number, updated: number, skipped: number, warned: number }}
   */
  batchInsertColumn(column, ohlcvData) {
    if (!MarketHistoryManager.COLUMN_WHITELIST.has(column)) {
      throw new Error(`batchInsertColumn: column '${column}' not in whitelist`);
    }

    const db = this._openDb();
    const stats = { inserted: 0, updated: 0, skipped: 0, warned: 0 };

    const selectStmt = db.prepare(`SELECT ${column} FROM market_snapshots WHERE date = ?`);
    const insertStmt = db.prepare(`INSERT OR IGNORE INTO market_snapshots (date, ${column}, created_at) VALUES (?, ?, ?)`);
    const updateStmt = db.prepare(`UPDATE market_snapshots SET ${column} = ? WHERE date = ?`);

    const tx = db.transaction((rows) => {
      const now = new Date().toISOString();
      for (const row of rows) {
        if (!row.date || typeof row.close !== 'number') continue;

        const existing = selectStmt.get(row.date);
        if (!existing) {
          // 該日不存在 → INSERT
          const r = insertStmt.run(row.date, row.close, now);
          if (r.changes > 0) stats.inserted++;
        } else if (existing[column] == null) {
          // 該日存在但 column 為 NULL → UPDATE
          updateStmt.run(row.close, row.date);
          stats.updated++;
        } else if (Math.abs(existing[column] - row.close) > 0.0001) {
          // 值不同 → warn，不覆寫
          logger.warn(`${column} ${row.date}: DB=${existing[column]} vs new=${row.close}, skip`);
          stats.warned++;
        } else {
          stats.skipped++;
        }
      }
    });

    tx(ohlcvData);
    logger.info(`batchInsertColumn(${column}): inserted=${stats.inserted}, updated=${stats.updated}, warned=${stats.warned}, skipped=${stats.skipped}`);
    return stats;
  }

  /**
   * 歷史查詢（PhaseEngine/BreadthCalculator/KeyLevelsEngine 呼叫）
   * SQL DESC + LIMIT 取最近 N 筆，JS .reverse() 成升冪
   * @param {string} column - 欄位名（必須在白名單中）
   * @param {number} days - 需要的天數（預設 250）
   * @returns {Array<{date:string, close:number}>} 升冪排序
   */
  getHistory(column, days = 250) {
    if (!MarketHistoryManager.COLUMN_WHITELIST.has(column)) {
      throw new Error(`getHistory: column '${column}' not in whitelist`);
    }

    const db = this._openDb();
    const sql = `SELECT date, ${column} AS close FROM market_snapshots WHERE ${column} IS NOT NULL ORDER BY date DESC LIMIT ?`;
    const rows = db.prepare(sql).all(days);
    rows.reverse(); // DESC → 升冪
    return rows;
  }

  /**
   * 計算移動平均（純計算函式）
   * @param {number[]} closes - 收盤價序列
   * @returns {{ ma20:number|null, ma50:number|null, ma200:number|null }}
   */
  static getMovingAverages(closes) {
    const calc = (arr, period) => {
      if (arr.length < period) return null;
      const slice = arr.slice(-period);
      return slice.reduce((a, b) => a + b, 0) / period;
    };
    return {
      ma20:  calc(closes, 20),
      ma50:  calc(closes, 50),
      ma200: calc(closes, 200)
    };
  }

  /**
   * 關閉 SQLite 連線（測試/graceful shutdown 用）
   */
  closeDb() {
    if (this._db) {
      this._db.close();
      this._db = null;
      logger.info('SQLite DB closed');
    }
  }
}

module.exports = { MarketHistoryManager };
