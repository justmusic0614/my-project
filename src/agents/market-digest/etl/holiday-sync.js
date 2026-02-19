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
const PDFParser = require('./pdf-parser');

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
   * 爬取 NYSE 休市日（多層降級鏈）
   * @param {number} year
   * @returns {Promise<array>} holidays
   */
  async _fetchXNYS(year) {
    // 降級策略：WebPage（優先）→ PDF（降級）→ HTML（最後手段）
    // WebPage: 從 NYSE 官網解析多年份表格，最穩定且無需 PDF 解析
    // PDF: 下載交易日曆 PDF，純文字提取（可能因格式限制失敗）
    // HTML: ICE 新聞稿網頁（可能被 Cloudflare 阻擋）
    const strategies = [
      { name: 'WebPage', fn: () => this._fetchFromNYSEWebPage(year) },
      { name: 'PDF',     fn: () => this._fetchFromPDF(year) },
      { name: 'HTML',    fn: () => this._fetchFromHTML(year) }
    ];

    const errors = [];

    for (const strategy of strategies) {
      try {
        logger.info(`🔍 Trying ${strategy.name} for NYSE ${year}...`);
        const result = await strategy.fn();

        // 驗證結果
        this._validateNYSEHolidays(result, year, strategy.name);

        logger.info(`✅ ${strategy.name}: ${result.length} holidays`);
        return result;

      } catch (err) {
        const errMsg = `${strategy.name} failed: ${err.message}`;
        logger.warn(`⚠️  ${errMsg}`);
        errors.push(errMsg);
      }
    }

    // 所有策略失敗
    const errorSummary = errors.join('; ');
    throw new Error(`All XNYS strategies failed: ${errorSummary}`);
  }

  /**
   * 從 PDF 爬取 NYSE 休市日
   * @param {number} year
   * @returns {Promise<array>} holidays
   */
  async _fetchFromPDF(year) {
    const pdfUrls = this.syncConfig.dataSources?.xnys?.pdfUrls || [
      `https://www.nyse.com/publicdocs/ICE_NYSE_${year}_Yearly_Trading_Calendar.pdf`,
      `https://www.nyse.com/publicdocs/nyse/ICE_NYSE_${year}_Yearly_Trading_Calendar.pdf`
    ];

    // 檢查 pdfjs-dist 是否可用
    if (!PDFParser.isAvailable()) {
      throw new Error('pdfjs-dist not installed. Run: npm install pdfjs-dist@2.16.105');
    }

    const parser = new PDFParser({ timeout: 30000 });
    let pdfText = null;
    let successUrl = null;

    // 嘗試所有 PDF URL
    for (const url of pdfUrls) {
      try {
        logger.info(`  Trying PDF: ${url}`);
        pdfText = await parser.extractText(url, { maxPages: 5 });
        if (pdfText && pdfText.length > 500) {
          successUrl = url;
          break;
        }
      } catch (err) {
        logger.warn(`  PDF URL failed: ${url} - ${err.message}`);
      }
    }

    if (!pdfText) {
      throw new Error('All PDF URLs failed');
    }

    logger.info(`  Extracted text from ${successUrl} (${pdfText.length} chars)`);

    // Regex 解析日期
    const holidays = this._parseNYSEPDFText(pdfText, year);
    logger.info(`  Parsed ${holidays.length} holidays from PDF`);

    return holidays;
  }

  /**
   * 從 HTML 爬取 NYSE 休市日（降級方案）
   * @param {number} year
   * @returns {Promise<array>} holidays
   */
  async _fetchFromHTML(year) {
    // ICE 新聞稿 URL（支援 fallback）
    const urls = this.syncConfig.dataSources?.xnys?.htmlUrls || [
      `https://ir.theice.com/press/news-details/${year-1}/NYSE-Group-Announces-${year}-${year+1}-and-${year+2}-Holiday-and-Early-Closings-Calendar/default.aspx`,
      `https://ir.theice.com/press/news-details/${year-2}/NYSE-Group-Announces-${year}-and-${year+1}-Holiday-Calendar/default.aspx`
    ];

    let html = null;
    let successUrl = null;

    // 嘗試所有 URL
    for (const url of urls) {
      try {
        logger.info(`  Trying HTML: ${url}`);
        html = await this.http.fetchText(url);
        if (html && html.length > 1000) {
          successUrl = url;
          break;
        }
      } catch (err) {
        logger.warn(`  HTML URL failed: ${url} - ${err.message}`);
      }
    }

    if (!html) {
      throw new Error('All HTML URLs failed');
    }

    logger.info(`  Fetched HTML from ${successUrl}`);

    // Regex 解析 table（復用現有邏輯）
    const holidays = this._parseNYSETable(html, year);
    logger.info(`  Parsed ${holidays.length} holidays from HTML`);

    return holidays;
  }

  /**
   * 從 NYSE 官網抓取休市日（網頁解析方案）
   * @param {number} year - 目標年份
   * @returns {Promise<array>} holidays
   */
  async _fetchFromNYSEWebPage(year) {
    const url = 'https://www.nyse.com/trade/hours-calendars';
    logger.info(`  Fetching NYSE web page: ${url}`);

    const html = await this.http.fetchText(url);
    if (!html || html.length < 1000) {
      throw new Error('NYSE web page fetch failed or empty');
    }

    const holidays = this._parseNYSETableMultiYear(html, year);
    logger.info(`  Parsed ${holidays.length} holidays from web page`);

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
   * 解析 NYSE 多年份表格（官網格式）
   * 表格格式：
   * | Holiday         | 2026      | 2027      | 2028      |
   * | New Year's Day  | January 1 | January 1 | January 1*|
   *
   * @param {string} html - HTML 內容
   * @param {number} targetYear - 目標年份
   * @returns {array} holidays - 休市日陣列 [{ date, status, reason }]
   */
  _parseNYSETableMultiYear(html, targetYear) {
    const holidays = [];

    // 提取 table 區塊
    const tableRegex = /<table[\s\S]*?>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHtml = tableMatch[1];

      // 提取所有 rows
      const rowRegex = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
      const rows = [];
      let rowMatch;

      while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
        rows.push(rowMatch[1]);
      }

      if (rows.length < 2) continue; // 至少需要 header + 1 data row

      // 解析 header row，識別年份列
      const headerRow = rows[0];
      const yearHeaders = [];
      const yearRegex = /<th[^>]*>(\d{4})<\/th>/g;
      let yearMatch;

      while ((yearMatch = yearRegex.exec(headerRow)) !== null) {
        yearHeaders.push(parseInt(yearMatch[1], 10));
      }

      if (yearHeaders.length === 0) continue; // 不是多年份表格

      // 定位目標年份索引
      const targetYearIndex = yearHeaders.indexOf(targetYear);
      if (targetYearIndex === -1) {
        logger.warn(`  Year ${targetYear} not found in table header (available: ${yearHeaders.join(', ')})`);
        continue;
      }

      logger.info(`  Found multi-year table with years: ${yearHeaders.join(', ')}, target year index: ${targetYearIndex}`);

      // 解析資料列（跳過 header row）
      for (let i = 1; i < rows.length; i++) {
        const rowHtml = rows[i];

        // 提取 cells（包含 th 和 td）
        const cells = [];

        // 第一列通常是 <th>（Holiday 名稱）
        const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let thMatch;
        while ((thMatch = thRegex.exec(rowHtml)) !== null) {
          const text = thMatch[1].replace(/<[^>]+>/g, '').trim();
          cells.push(text);
        }

        // 其他列是 <td>（日期）
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdMatch;
        while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
          const text = tdMatch[1].replace(/<[^>]+>/g, '').trim();
          cells.push(text);
        }

        if (cells.length < 2) continue;

        // cells[0] = "New Year's Day"
        // cells[targetYearIndex + 1] = "January 1*"（+1 因為第一列是 Holiday 名稱）
        const reason = cells[0];
        const dateText = cells[targetYearIndex + 1];

        if (!dateText || dateText === '') continue;

        // 處理早收標記（*）
        const hasEarlyClose = dateText.includes('*');
        const cleanDateText = dateText.replace(/\*/g, '').trim();

        // 解析日期格式："January 1" 或 "January 1, 2026"
        // 支援多種格式：
        // - "January 1"（無年份，使用 targetYear）
        // - "January 1, 2026"（含年份）
        // - "Jan 1"（縮寫）
        const dateMatch = cleanDateText.match(/(\w+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
        if (!dateMatch) continue;

        const monthStr = dateMatch[1];
        const day      = parseInt(dateMatch[2], 10);
        const yr       = dateMatch[3] ? parseInt(dateMatch[3], 10) : targetYear;

        // 確保年份正確（如果 HTML 包含年份，應該與 targetYear 一致）
        if (dateMatch[3] && yr !== targetYear) {
          logger.warn(`  Date year mismatch: ${cleanDateText} (expected ${targetYear})`);
          continue;
        }

        // 月份映射（支援全名和縮寫）
        const monthMap = {
          January: '01', Jan: '01',
          February: '02', Feb: '02',
          March: '03', Mar: '03',
          April: '04', Apr: '04',
          May: '05',
          June: '06', Jun: '06',
          July: '07', Jul: '07',
          August: '08', Aug: '08',
          September: '09', Sep: '09',
          October: '10', Oct: '10',
          November: '11', Nov: '11',
          December: '12', Dec: '12'
        };

        const month = monthMap[monthStr];
        if (!month) {
          logger.warn(`  Unknown month: ${monthStr}`);
          continue;
        }

        const date = `${yr}-${month}-${day.toString().padStart(2, '0')}`;

        // 判斷狀態（早收 vs 全天休市）
        let status = 'CLOSED';
        if (hasEarlyClose || reason.toLowerCase().includes('early close')) {
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
   * 解析 NYSE PDF 純文字
   * @param {string} pdfText
   * @param {number} year
   * @returns {array} holidays
   */
  _parseNYSEPDFText(pdfText, year) {
    const holidays = [];

    // 常見的 NYSE 休市日名稱（用於識別）
    const holidayKeywords = [
      "New Year's Day",
      'Martin Luther King',
      "Presidents'? Day",
      'Good Friday',
      'Memorial Day',
      'Juneteenth',
      'Independence Day',
      'Labor Day',
      'Thanksgiving',
      'Christmas',
      'Early Close',
      'early close'
    ];

    // 月份對照
    const monthMap = {
      January: '01', February: '02', March: '03', April: '04',
      May: '05', June: '06', July: '07', August: '08',
      September: '09', October: '10', November: '11', December: '12',
      Jan: '01', Feb: '02', Mar: '03', Apr: '04',
      Jun: '06', Jul: '07', Aug: '08', Sep: '09',
      Oct: '10', Nov: '11', Dec: '12'
    };

    // Regex 模式：捕捉 "Month Day, Year" 或 "Month Day Year"
    // 範例：January 1, 2026 / Jan. 1, 2026 / January 1 2026
    const datePattern = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi;

    let match;
    while ((match = datePattern.exec(pdfText)) !== null) {
      const monthStr = match[1];
      const day      = parseInt(match[2], 10);
      const yr       = parseInt(match[3], 10);

      if (yr !== year) continue;

      const month = monthMap[monthStr];
      if (!month) continue;

      const date = `${yr}-${month}-${day.toString().padStart(2, '0')}`;

      // 嘗試提取前後文字（推測原因）
      const startPos = Math.max(0, match.index - 100);
      const endPos   = Math.min(pdfText.length, match.index + 100);
      const context  = pdfText.substring(startPos, endPos);

      // 判斷是否為休市日（檢查上下文是否包含關鍵字）
      const isHoliday = holidayKeywords.some(kw => {
        const regex = new RegExp(kw, 'i');
        return regex.test(context);
      });

      if (!isHoliday) continue;

      // 推測原因（從上下文提取）
      let reason = 'Holiday';
      for (const kw of holidayKeywords) {
        const regex = new RegExp(kw, 'i');
        if (regex.test(context)) {
          reason = kw.replace(/\?/g, '');  // 移除 regex 特殊字元
          break;
        }
      }

      // 判斷狀態（早收 vs 全天休市）
      let status = 'CLOSED';
      if (context.toLowerCase().includes('early close') ||
          context.toLowerCase().includes('1:00 pm') ||
          context.toLowerCase().includes('13:00')) {
        status = 'EARLY_CLOSE';
      }

      holidays.push({ date, status, reason });
    }

    // 去重
    const uniqueMap = new Map();
    for (const h of holidays) {
      if (!uniqueMap.has(h.date)) {
        uniqueMap.set(h.date, h);
      }
    }

    return Array.from(uniqueMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * 驗證 NYSE 休市日資料
   * @param {array} holidays
   * @param {number} year
   * @param {string} source - 資料來源（用於錯誤訊息）
   */
  _validateNYSEHolidays(holidays, year, source) {
    // 1. 數量檢查（NYSE 通常 9-12 個全天休市日）
    if (!holidays || holidays.length < 8) {
      throw new Error(`${source}: Too few holidays (${holidays?.length || 0}), expected at least 8`);
    }

    if (holidays.length > 20) {
      logger.warn(`${source}: Abnormally high holiday count (${holidays.length})`);
    }

    // 2. 必須包含 New Year's Day（除非是過去年份的特殊情況）
    const hasNewYear = holidays.some(h => h.date === `${year}-01-01`);
    if (!hasNewYear && year >= 2020) {
      logger.warn(`${source}: Missing New Year's Day for ${year}`);
    }

    // 3. 日期格式驗證
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const invalidDates = holidays.filter(h => !dateRegex.test(h.date));
    if (invalidDates.length > 0) {
      throw new Error(`${source}: Invalid date format found: ${invalidDates.map(h => h.date).join(', ')}`);
    }

    // 4. 必要欄位檢查
    const missingFields = holidays.filter(h => !h.date || !h.status || !h.reason);
    if (missingFields.length > 0) {
      throw new Error(`${source}: Missing required fields (date/status/reason)`);
    }

    logger.info(`✅ Validation passed: ${holidays.length} holidays for ${year}`);
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
