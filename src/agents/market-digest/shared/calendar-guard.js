/**
 * CalendarGuard — 市場日曆查詢模組
 * 判斷指定日期是否為交易日（TWSE / XNYS）
 *
 * 資料來源：data/calendar/holidays-YYYY.json（靜態 JSON）
 * 設計：Singleton，啟動時載入當年度 JSON 並快取
 */

'use strict';

const crypto = require('crypto');
const fs   = require('fs');
const path = require('path');
const { createLogger } = require('./logger');

const logger = createLogger('calendar-guard');

const CALENDAR_DIR = path.join(__dirname, '../data/calendar');

const MarketStatus = {
  OPEN:            'OPEN',
  CLOSED:          'CLOSED',
  SETTLEMENT_ONLY: 'SETTLEMENT_ONLY',
  EARLY_CLOSE:     'EARLY_CLOSE',
  UNKNOWN:         'UNKNOWN'
};

class CalendarGuard {
  constructor() {
    // { "2026": { "TWSE": Map<dateStr, holiday>, "XNYS": Map<dateStr, holiday> } }
    this._cache = {};
  }

  /**
   * 查詢指定日期是否為交易日
   * @param {string} market - 'TWSE' | 'XNYS'
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @returns {{ isTradingDay: boolean, status: string, reason: string|null }}
   */
  isTradingDay(market, dateStr) {
    if (this._isWeekend(dateStr)) {
      return { isTradingDay: false, status: MarketStatus.CLOSED, reason: '週末' };
    }

    const year = dateStr.slice(0, 4);
    const holidays = this._loadCalendar(market, year);
    const holiday = holidays.get(dateStr);

    if (!holiday) {
      return { isTradingDay: true, status: MarketStatus.OPEN, reason: null };
    }

    if (holiday.status === MarketStatus.EARLY_CLOSE) {
      return { isTradingDay: true, status: MarketStatus.EARLY_CLOSE, reason: holiday.reason };
    }

    // CLOSED or SETTLEMENT_ONLY → 不交易
    return { isTradingDay: false, status: holiday.status, reason: holiday.reason };
  }

  /**
   * 批次查詢：回傳 TWSE + XNYS 的市場狀態
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @returns {{ twse: object, xnys: object }}
   */
  getMarketContext(dateStr) {
    return {
      twse: this.isTradingDay('TWSE', dateStr),
      xnys: this.isTradingDay('XNYS', dateStr)
    };
  }

  /**
   * 取得前一個交易日
   * @param {string} market
   * @param {string} fromDate - 'YYYY-MM-DD'
   * @returns {string|null}
   */
  getPrevTradingDay(market, fromDate) {
    const d = new Date(fromDate + 'T00:00:00');
    for (let i = 0; i < 30; i++) {
      d.setDate(d.getDate() - 1);
      const ds = d.toISOString().slice(0, 10);
      const { isTradingDay } = this.isTradingDay(market, ds);
      if (isTradingDay) return ds;
    }
    return null;
  }

  /**
   * 取得下一個交易日
   * @param {string} market
   * @param {string} fromDate - 'YYYY-MM-DD'
   * @returns {string|null}
   */
  getNextTradingDay(market, fromDate) {
    const d = new Date(fromDate + 'T00:00:00');
    for (let i = 0; i < 30; i++) {
      d.setDate(d.getDate() + 1);
      const ds = d.toISOString().slice(0, 10);
      const { isTradingDay } = this.isTradingDay(market, ds);
      if (isTradingDay) return ds;
    }
    return null;
  }

  // ── 內部方法 ─────────────────────────────────────────────────────────────

  /**
   * 載入並快取指定年份的休市資料
   * @returns {Map<string, object>} dateStr → holiday object
   */
  _loadCalendar(market, year) {
    const cacheKey = `${year}:${market}`;
    if (this._cache[cacheKey]) return this._cache[cacheKey];

    const map = new Map();
    const filePath = path.join(CALENDAR_DIR, `holidays-${year}.json`);

    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const holidays = data.markets?.[market]?.holidays || [];
        for (const h of holidays) {
          map.set(h.date, h);
        }
        logger.debug(`loaded ${map.size} holidays for ${market} ${year}`);
      } else {
        logger.warn(`calendar file not found: ${filePath}`);
      }
    } catch (err) {
      logger.error(`failed to load calendar ${filePath}: ${err.message}`);
    }

    this._cache[cacheKey] = map;
    return map;
  }

  _isWeekend(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  /**
   * 計算指定市場年度的休市日 MD5 hash
   * （供 ETL 同步時比對變更使用）
   * @param {string} market - 'TWSE' | 'XNYS'
   * @param {number} year
   * @returns {string} MD5 hash (32 字元)
   */
  getHolidaysHash(market, year) {
    const holidays = this._loadCalendar(market, year.toString());
    const data = Array.from(holidays.values())
      .map(h => `${h.date}|${h.status}|${h.reason}`)
      .sort()
      .join('\n');
    return crypto.createHash('md5').update(data).digest('hex');
  }
}

// 單例
let instance = null;

function getCalendarGuard() {
  if (!instance) instance = new CalendarGuard();
  return instance;
}

function resetCalendarGuard() {
  instance = null;
}

module.exports = { CalendarGuard, MarketStatus, getCalendarGuard, resetCalendarGuard };
