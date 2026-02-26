/**
 * ArchivePublisher — 本地存檔 + Git 備份
 * 負責：
 *   - 將日報/週報存為 JSON（完整資料）+ TXT（可讀文字）
 *   - 維護索引 JSON（index.json）
 *   - 可選的 Git commit（在 VPS 環境下）
 *   - 資料保留策略（超過 N 天的舊檔自動刪除）
 *
 * 輸出目錄：
 *   data/daily-brief/YYYY-MM-DD.json
 *   data/daily-brief/YYYY-MM-DD.txt
 *   data/daily-brief/index.json
 *   data/weekly-report/YYYY-WXX.json
 *   data/weekly-report/YYYY-WXX.txt
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createLogger } = require('../shared/logger');

const logger = createLogger('publisher:archive');

const RETENTION_DAYS = 30; // daily-brief 保留 30 天（SQLite 永久保留）
const DB_FILE = 'market-history.db'; // 相對於 data/ 目錄

class ArchivePublisher {
  constructor(config = {}) {
    this.basePath    = config.basePath || path.join(__dirname, '..', 'data');
    this.dailyPath   = config.dailyPath   || path.join(this.basePath, 'daily-brief');
    this.weeklyPath  = config.weeklyPath  || path.join(this.basePath, 'weekly-report');
    this.gitEnabled  = config.gitEnabled !== false; // 預設開啟
    this.gitWorkDir  = config.gitWorkDir  || path.join(__dirname, '..', '..', '..', '..');
    this.retentionDays = config.retentionDays || RETENTION_DAYS;

    this._ensureDirs();
  }

  /**
   * 存檔日報
   * @param {string} date       - YYYY-MM-DD
   * @param {string} text       - 已渲染的文字報告
   * @param {object} briefData  - Phase 3 輸出的完整資料（JSON）
   * @returns {object} { jsonPath, txtPath }
   */
  archiveDailyBrief(date, text, briefData = {}) {
    const jsonPath = path.join(this.dailyPath, `${date}.json`);
    const txtPath  = path.join(this.dailyPath, `${date}.txt`);

    // 寫入 JSON（完整資料）
    const jsonData = {
      date,
      generatedAt: new Date().toISOString(),
      marketData:  briefData.marketData || {},
      aiResult:    briefData.aiResult || {},
      newsCount:   (briefData.rankedNews || []).length,
      validationReport: briefData.validationReport || {}
    };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf8');

    // 寫入 TXT（可讀文字）
    fs.writeFileSync(txtPath, text, 'utf8');

    // 更新 index.json
    this._updateIndex(this.dailyPath, date, { type: 'daily', date, txtPath: path.basename(txtPath) });

    logger.info(`daily brief archived: ${jsonPath}`);

    // 自動清理舊檔
    this._purgeOldFiles(this.dailyPath, this.retentionDays);

    // 永久歸檔到 SQLite（回測用）
    this._archiveToDb(date, briefData.marketData || {});

    return { jsonPath, txtPath };
  }

  /**
   * 存檔週報
   * @param {string} weekLabel  - YYYY-WXX
   * @param {string} text
   * @param {object} weeklyData
   */
  archiveWeeklyReport(weekLabel, text, weeklyData = {}) {
    const jsonPath = path.join(this.weeklyPath, `${weekLabel}.json`);
    const txtPath  = path.join(this.weeklyPath, `${weekLabel}.txt`);

    fs.writeFileSync(jsonPath, JSON.stringify({ weekLabel, generatedAt: new Date().toISOString(), ...weeklyData }, null, 2), 'utf8');
    fs.writeFileSync(txtPath,  text, 'utf8');

    this._updateIndex(this.weeklyPath, weekLabel, { type: 'weekly', weekLabel });

    logger.info(`weekly report archived: ${jsonPath}`);
    return { jsonPath, txtPath };
  }

  /**
   * Git commit（VPS 環境用，配合 deploy 腳本）
   * @param {string} message - commit message
   */
  gitCommit(message) {
    if (!this.gitEnabled) {
      logger.info('git commit disabled, skipping');
      return false;
    }

    try {
      const dataDir = path.relative(this.gitWorkDir, this.basePath);
      execSync(`git -C "${this.gitWorkDir}" add "${dataDir}"`, { stdio: 'pipe' });
      execSync(`git -C "${this.gitWorkDir}" diff --cached --quiet || git -C "${this.gitWorkDir}" commit -m "${message.replace(/"/g, "'")}"`, { stdio: 'pipe' });
      logger.info(`git committed: ${message}`);
      return true;
    } catch (err) {
      logger.warn(`git commit failed: ${err.message}`);
      return false;
    }
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  _updateIndex(dir, key, entry) {
    const indexPath = path.join(dir, 'index.json');
    let index = {};

    try {
      if (fs.existsSync(indexPath)) {
        index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      }
    } catch { index = {}; }

    index[key] = { ...entry, updatedAt: new Date().toISOString() };

    // 只保留最近 90 筆
    const keys = Object.keys(index).sort().reverse().slice(0, 90);
    const trimmed = {};
    keys.forEach(k => { trimmed[k] = index[k]; });

    fs.writeFileSync(indexPath, JSON.stringify(trimmed, null, 2), 'utf8');
  }

  _purgeOldFiles(dir, retentionDays) {
    const cutoff = Date.now() - retentionDays * 86400000;

    try {
      const files = fs.readdirSync(dir).filter(f => f !== 'index.json');
      let purged = 0;
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          purged++;
        }
      }
      if (purged > 0) logger.info(`purged ${purged} old files from ${dir}`);
    } catch (err) {
      logger.warn(`purge failed: ${err.message}`);
    }
  }

  _ensureDirs() {
    [this.dailyPath, this.weeklyPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 將當日 marketData 寫入 SQLite（永久保留，供回測使用）
   * 使用 better-sqlite3（同步 API，不影響 async 流程）
   */
  _archiveToDb(date, md) {
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch {
      logger.warn('better-sqlite3 not available, skipping DB archive');
      return;
    }

    const dbPath = path.join(this.basePath, DB_FILE);
    let db;
    try {
      db = new Database(dbPath);

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

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO market_snapshots
          (date, sp500, nasdaq, taiex, vix, dxy, us10y,
           gold, oil_wti, copper, btc, usdtwd, fed_rate, hy_spread,
           sp500_chg, nasdaq_chg, taiex_chg, vix_chg,
           source_quality, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        date,
        md.SP500?.value,   md.NASDAQ?.value,  md.TAIEX?.value,
        md.VIX?.value,     md.DXY?.value,     md.US10Y?.value,
        md.GOLD?.value,    md.OIL_WTI?.value, md.COPPER?.value,
        md.BTC?.value,     md.USDTWD?.value,
        md.FED_RATE?.value, md.HY_SPREAD?.value,
        md.SP500?.changePct,  md.NASDAQ?.changePct,
        md.TAIEX?.changePct,  md.VIX?.changePct,
        this._sourceQuality(md),
        new Date().toISOString()
      );

      logger.info(`market-history.db: archived ${date} (${this._sourceQuality(md)})`);
    } catch (err) {
      logger.warn(`DB archive failed for ${date}: ${err.message}`);
    } finally {
      if (db) db.close();
    }
  }

  /**
   * 評估數據品質標籤
   * 'full' = 主要指標全部有效
   * 'partial' = 1 個主要指標缺失/降級
   * 'degraded' = 2+ 個主要指標缺失/降級
   */
  _sourceQuality(md) {
    const degraded = [md.SP500, md.NASDAQ, md.TAIEX, md.VIX]
      .filter(v => !v || v.degraded === 'NA' || v.degraded === 'UNVERIFIED').length;
    if (degraded === 0) return 'full';
    if (degraded <= 1) return 'partial';
    return 'degraded';
  }
}

module.exports = ArchivePublisher;
