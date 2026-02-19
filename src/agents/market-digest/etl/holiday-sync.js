/**
 * HolidaySync — 休市日 ETL 自動同步模組
 *
 * 功能：
 *   - 爬取 TWSE API + NYSE HTML table
 *   - Hash 比對偵測變更
 *   - 自動更新 holidays-YYYY.json
 *   - Git commit + Telegram 告警
 *
 * 使用方式：
 *   const sync = new HolidaySync(config);
 *   await sync.syncYear(2026, { dryRun: true });
 *   await sync.syncCurrentAndNext();
 */

'use strict';

const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const { createLogger } = require('../shared/logger');
const { getCalendarGuard } = require('../shared/calendar-guard');
const { HttpClient } = require('../shared/http-client');

const logger = createLogger('etl:holiday-sync');

const CALENDAR_DIR = path.join(__dirname, '../data/calendar');

class HolidaySync {
  constructor(config = {}) {
    this.config = config;
    this.http   = new HttpClient({ userAgent: 'MarketDigest/1.0 (Holiday Sync)' });
    this.guard  = getCalendarGuard();

    // 配置
    this.syncConfig = config.calendarSync || {};
    this.autoUpdate = this.syncConfig.autoUpdate !== false;
    this.gitCommit  = this.syncConfig.gitCommit !== false;
    this.telegramAlert = this.syncConfig.telegramAlert?.enabled !== false;
  }

  /**
   * 同步指定年度休市日
   * @param {number} year - 年度（如 2026）
   * @param {object} opts - 選項
   * @param {boolean} opts.dryRun - Dry-run 模式（不實際寫入）
   * @param {boolean} opts.includeNext - 同時同步次年
   * @returns {Promise<object>} 同步結果
   */
  async syncYear(year, opts = {}) {
    const dryRun = opts.dryRun !== undefined ? opts.dryRun : !this.autoUpdate;

    logger.info(`=== Holiday Sync starting: year=${year}, dryRun=${dryRun} ===`);
    const startTime = Date.now();

    const results = {};

    // 同步當年
    results.current = await this._syncSingleYear(year, dryRun);

    // 同步次年（11 月預填）
    if (opts.includeNext) {
      results.next = await this._syncSingleYear(year + 1, dryRun);
    }

    const duration = Date.now() - startTime;
    logger.info(`=== Holiday Sync complete: ${Math.round(duration / 1000)}s ===`);

    return { year, dryRun, results, duration };
  }

  /**
   * 同步當年 + 次年（11 月執行）
   */
  async syncCurrentAndNext() {
    const year = new Date().getFullYear();
    return await this.syncYear(year, { includeNext: true });
  }

  /**
   * 同步單一年度（內部方法）
   */
  async _syncSingleYear(year, dryRun) {
    logger.info(`Syncing year ${year}...`);

    try {
      // 並行爬取 TWSE + XNYS
      const [twseData, xnysData] = await Promise.all([
        this._fetchTWSE(year).catch(err => {
          logger.error(`TWSE fetch failed: ${err.message}`);
          return null;
        }),
        this._fetchXNYS(year).catch(err => {
          logger.error(`XNYS fetch failed: ${err.message}`);
          return null;
        })
      ]);

      if (!twseData && !xnysData) {
        throw new Error(`Both TWSE and XNYS fetch failed for ${year}`);
      }

      // Hash 比對並更新
      const twseResult = twseData ? await this._compareAndUpdate('TWSE', year, twseData, dryRun) : null;
      const xnysResult = xnysData ? await this._compareAndUpdate('XNYS', year, xnysData, dryRun) : null;

      return {
        success: true,
        twse: twseResult,
        xnys: xnysResult
      };
    } catch (err) {
      logger.error(`Sync failed for ${year}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * 爬取 TWSE 休市日（JSON API）
   * @param {number} year
   * @returns {Promise<array>} holidays
   */
  async _fetchTWSE(year) {
    const url = 'https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json';

    logger.info(`Fetching TWSE holidays from ${url}...`);

    const json = await this.http.fetchJSON(url);

    if (!json || !Array.isArray(json.data)) {
      throw new Error('TWSE API returned invalid data format');
    }

    // 轉換為統一格式
    const holidays = [];
    for (const row of json.data) {
      // row format: ["20260101", "元旦", "放假之紀念日及節日"] or similar
      if (!Array.isArray(row) || row.length < 2) continue;

      let dateStr = row[0];  // "2026-01-01" or "20260101"
      const reason  = row[1];  // "中華民國開國紀念日"
      const type    = row[2];  // "依規定放假1日。"

      // 解析日期（支援兩種格式）
      let date;
      if (dateStr.includes('-')) {
        // 已經是 ISO 格式 "YYYY-MM-DD"
        date = dateStr;
      } else {
        // 舊格式 "20260101"
        const y = dateStr.slice(0, 4);
        const m = dateStr.slice(4, 6);
        const d = dateStr.slice(6, 8);
        date = `${y}-${m}-${d}`;
      }

      // 過濾指定年度
      const y = parseInt(date.slice(0, 4), 10);
      if (y !== year) continue;

      // 判斷狀態（結算交割 vs 完全休市）
      let status = 'CLOSED';
      if ((type && type.includes('結算交割')) || (reason && reason.includes('結算交割'))) {
        status = 'SETTLEMENT_ONLY';
      }

      holidays.push({ date, status, reason });
    }

    logger.info(`TWSE: fetched ${holidays.length} holidays for ${year}`);
    return holidays;
  }

  /**
   * 爬取 NYSE 休市日（HTML table regex）
   * @param {number} year
   * @returns {Promise<array>} holidays
   */
  async _fetchXNYS(year) {
    // ICE 新聞稿 URL（支援 fallback）
    const urls = this.syncConfig.dataSources?.xnys?.holidayUrls || [
      `https://ir.theice.com/press/news-details/${year-1}/NYSE-Group-Announces-${year}-${year+1}-and-${year+2}-Holiday-and-Early-Closings-Calendar/default.aspx`,
      `https://ir.theice.com/press/news-details/${year-2}/NYSE-Group-Announces-${year}-and-${year+1}-Holiday-Calendar/default.aspx`
    ];

    let html = null;
    let successUrl = null;

    // 嘗試所有 URL
    for (const url of urls) {
      try {
        logger.info(`Trying NYSE URL: ${url}`);
        html = await this.http.fetchText(url);
        if (html && html.length > 1000) {
          successUrl = url;
          break;
        }
      } catch (err) {
        logger.warn(`NYSE URL failed: ${url} - ${err.message}`);
      }
    }

    if (!html) {
      throw new Error('All NYSE URLs failed');
    }

    logger.info(`Fetched NYSE HTML from ${successUrl}`);

    // Regex 解析 table（復用 RSS collector 模式）
    const holidays = this._parseNYSETable(html, year);
    logger.info(`NYSE: parsed ${holidays.length} holidays for ${year}`);

    return holidays;
  }

  /**
   * 解析 NYSE HTML table
   * @param {string} html
   * @param {number} year
   * @returns {array} holidays
   */
  _parseNYSETable(html, year) {
    const holidays = [];

    // 提取 table 區塊
    const tableRegex = /<table[\s\S]*?>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tableMatch[1];

      // 提取 rows
      const rowRegex = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
      let rowMatch;

      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        const rowHtml = rowMatch[1];

        // 提取 cells
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
          // 去除 HTML tags
          const text = cellMatch[1].replace(/<[^>]+>/g, '').trim();
          cells.push(text);
        }

        if (cells.length < 2) continue;

        // cells[0] = "New Year's Day", cells[1] = "Thursday, January 1, 2026"
        const reason = cells[0];
        const dateText = cells[1];

        // 解析日期（支援多種格式）
        const dateMatch = dateText.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (!dateMatch) continue;

        const monthStr = dateMatch[1];
        const day      = parseInt(dateMatch[2], 10);
        const yr       = parseInt(dateMatch[3], 10);

        if (yr !== year) continue;

        const monthMap = {
          January: '01', February: '02', March: '03', April: '04',
          May: '05', June: '06', July: '07', August: '08',
          September: '09', October: '10', November: '11', December: '12'
        };

        const month = monthMap[monthStr];
        if (!month) continue;

        const date = `${yr}-${month}-${day.toString().padStart(2, '0')}`;

        // 判斷狀態（早收 vs 全天休市）
        let status = 'CLOSED';
        if (reason.toLowerCase().includes('early close') ||
            dateText.toLowerCase().includes('1:00 pm') ||
            dateText.toLowerCase().includes('early')) {
          status = 'EARLY_CLOSE';
        }

        holidays.push({ date, status, reason });
      }
    }

    // 去重（同一日期可能出現多次）
    const uniqueMap = new Map();
    for (const h of holidays) {
      if (!uniqueMap.has(h.date)) {
        uniqueMap.set(h.date, h);
      }
    }

    return Array.from(uniqueMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Hash 比對並更新
   * @param {string} market - 'TWSE' | 'XNYS'
   * @param {number} year
   * @param {array} newHolidays
   * @param {boolean} dryRun
   * @returns {Promise<object>} 更新結果
   */
  async _compareAndUpdate(market, year, newHolidays, dryRun) {
    const filePath = path.join(CALENDAR_DIR, `holidays-${year}.json`);

    // 讀取現有檔案
    let existingData = null;
    if (fs.existsSync(filePath)) {
      existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    const existingHolidays = existingData?.markets?.[market]?.holidays || [];

    // 計算 hash
    const oldHash = this._calcHash(existingHolidays);
    const newHash = this._calcHash(newHolidays);

    if (oldHash === newHash) {
      logger.info(`${market} ${year}: No changes (hash match)`);
      return { changed: false, hash: newHash };
    }

    // 產生 diff
    const diff = this._calcDiff(existingHolidays, newHolidays);
    logger.info(`${market} ${year}: Changes detected`, diff.summary);

    if (dryRun) {
      // Dry-run: 寫入 .new 檔案
      const newFilePath = `${filePath}.new`;
      this._writeHolidayFile(newFilePath, year, market, newHolidays, existingData);
      logger.info(`Dry-run: wrote ${newFilePath}`);

      // Telegram 告警
      if (this.telegramAlert) {
        await this._sendTelegramAlert(market, year, diff, { dryRun: true, filePath: newFilePath });
      }

      return { changed: true, dryRun: true, diff, newFilePath };
    } else {
      // Auto mode: 直接更新
      this._writeHolidayFile(filePath, year, market, newHolidays, existingData);
      logger.info(`Updated ${filePath}`);

      // Git commit
      let commitHash = null;
      if (this.gitCommit) {
        commitHash = await this._gitCommit(market, year, diff);
      }

      // Telegram 告警
      if (this.telegramAlert) {
        await this._sendTelegramAlert(market, year, diff, { commitHash });
      }

      return { changed: true, diff, commitHash };
    }
  }

  /**
   * 計算 holidays array 的 MD5 hash
   */
  _calcHash(holidays) {
    const data = holidays
      .map(h => `${h.date}|${h.status}|${h.reason}`)
      .sort()
      .join('\n');
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 計算 diff
   */
  _calcDiff(oldHolidays, newHolidays) {
    const oldMap = new Map(oldHolidays.map(h => [h.date, h]));
    const newMap = new Map(newHolidays.map(h => [h.date, h]));

    const added   = [];
    const removed = [];
    const modified = [];

    for (const [date, h] of newMap) {
      if (!oldMap.has(date)) {
        added.push(h);
      } else if (JSON.stringify(oldMap.get(date)) !== JSON.stringify(h)) {
        modified.push({ old: oldMap.get(date), new: h });
      }
    }

    for (const [date, h] of oldMap) {
      if (!newMap.has(date)) {
        removed.push(h);
      }
    }

    return {
      added,
      removed,
      modified,
      summary: {
        added: added.length,
        removed: removed.length,
        modified: modified.length
      }
    };
  }

  /**
   * 寫入 holidays JSON 檔案（atomic write）
   */
  _writeHolidayFile(filePath, year, market, holidays, existingData) {
    let data = existingData || {
      version: `${year}.1`,
      lastUpdated: new Date().toISOString().slice(0, 10),
      source: 'auto-sync',
      markets: {}
    };

    // 更新指定市場的休市日
    if (!data.markets[market]) {
      data.markets[market] = {
        timezone: market === 'TWSE' ? 'Asia/Taipei' : 'America/New_York',
        tradingHours: market === 'TWSE'
          ? { open: '09:00', close: '13:30' }
          : { open: '09:30', close: '16:00' },
        holidays: []
      };
    }

    data.markets[market].holidays = holidays;
    data.lastUpdated = new Date().toISOString().slice(0, 10);

    // Atomic write
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * Git commit
   */
  async _gitCommit(market, year, diff) {
    const { added, removed, modified } = diff.summary;
    const parts = [];
    if (added > 0) parts.push(`+${added}`);
    if (removed > 0) parts.push(`-${removed}`);
    if (modified > 0) parts.push(`~${modified}`);

    const msg = `chore(calendar): ${market} ${year} ${parts.join(' ')} holidays

Auto-synced from official source

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`;

    try {
      const { execSync } = require('child_process');
      const cwd = path.join(__dirname, '..');

      execSync(`git add data/calendar/holidays-${year}.json`, { cwd });
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd });

      const hash = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8' }).trim();
      logger.info(`Git commit: ${hash}`);
      return hash;
    } catch (err) {
      logger.error(`Git commit failed: ${err.message}`);
      return null;
    }
  }

  /**
   * 發送 Telegram 告警
   */
  async _sendTelegramAlert(market, year, diff, opts = {}) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId   = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      logger.warn('Telegram credentials not configured');
      return;
    }

    const { added, removed, modified } = diff;
    const lines = [];

    if (opts.dryRun) {
      lines.push('📅 休市日變更偵測（Dry-run）');
    } else {
      lines.push('📅 休市日自動更新完成');
    }

    lines.push('');
    lines.push(`市場：${market} ${year}`);
    lines.push('');
    lines.push('變更摘要：');

    if (added.length > 0) {
      lines.push(`  ✅ 新增 ${added.length} 天`);
      added.slice(0, 5).forEach(h => lines.push(`     • ${h.date}（${h.reason}）`));
      if (added.length > 5) lines.push(`     ... +${added.length - 5} more`);
    }

    if (removed.length > 0) {
      lines.push(`  ❌ 移除 ${removed.length} 天`);
      removed.slice(0, 5).forEach(h => lines.push(`     • ${h.date}（${h.reason}）`));
      if (removed.length > 5) lines.push(`     ... +${removed.length - 5} more`);
    }

    if (modified.length > 0) {
      lines.push(`  🔄 修改 ${modified.length} 天`);
    }

    if (opts.dryRun) {
      lines.push('');
      lines.push(`檔案：已產生 ${path.basename(opts.filePath)}`);
      lines.push('執行指令以應用：');
      lines.push('  node index.js sync-holidays --apply');
    } else {
      lines.push('');
      lines.push(`執行：已自動更新 holidays-${year}.json`);
      if (opts.commitHash) {
        lines.push(`Commit: ${opts.commitHash}`);
      }
    }

    const text = lines.join('\n');

    try {
      const https = require('https');
      const postData = JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      });

      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, res => {
        logger.info(`Telegram alert sent: ${res.statusCode}`);
      });

      req.on('error', err => logger.error(`Telegram alert failed: ${err.message}`));
      req.write(postData);
      req.end();
    } catch (err) {
      logger.error(`Telegram alert error: ${err.message}`);
    }
  }
}

module.exports = HolidaySync;
