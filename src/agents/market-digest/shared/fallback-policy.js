/**
 * FallbackPolicy — 統一的資料降級策略
 * 當 API 無資料時，判斷原因（休市 vs API 故障）並決定行為
 *
 * 流程：
 *   1. 查 CalendarGuard.isTradingDay()
 *   2. CLOSED/SETTLEMENT_ONLY → accept（正常，休市日無數據）
 *   3. OPEN → retry（maxRetries=3, backoff: 1s/3s/10s）
 *   4. retry 仍失敗 → fallback to prev_session（getPrevTradingDay 的資料）
 *   5. UNKNOWN → 同 OPEN 邏輯
 */

'use strict';

const { getCalendarGuard, MarketStatus } = require('./calendar-guard');
const { createLogger } = require('./logger');

const logger = createLogger('fallback-policy');

const DataQuality = {
  OK:             'OK',
  PARTIAL:        'PARTIAL',
  FALLBACK:       'FALLBACK',
  NO_MARKET_DATA: 'NO_MARKET_DATA'
};

const RETRY_DELAYS = [1000, 3000, 10000]; // 1s, 3s, 10s

class FallbackPolicy {
  /**
   * 判斷 API 無資料時的處理方式
   * @param {string} market - 'TWSE' | 'XNYS'
   * @param {string} dateStr - 'YYYY-MM-DD'
   * @param {Function|null} retryFn - async () => data，重試用的函式
   * @returns {Promise<{ action: string, quality: string, reason: string|null, data: any }>}
   */
  async handleNoData(market, dateStr, retryFn = null) {
    const guard = getCalendarGuard();
    const { isTradingDay, status, reason } = guard.isTradingDay(market, dateStr);

    // 休市日 → 接受無資料
    if (!isTradingDay && (status === MarketStatus.CLOSED || status === MarketStatus.SETTLEMENT_ONLY)) {
      logger.info(`${market} ${dateStr} is ${status} (${reason}), accepting no data`);
      return { action: 'accept', quality: DataQuality.NO_MARKET_DATA, reason, data: null };
    }

    // OPEN 或 UNKNOWN → 嘗試 retry
    if (retryFn) {
      for (let i = 0; i < RETRY_DELAYS.length; i++) {
        await _sleep(RETRY_DELAYS[i]);
        try {
          const data = await retryFn();
          if (data) {
            logger.info(`${market} retry ${i + 1} succeeded`);
            return { action: 'ok', quality: DataQuality.OK, reason: null, data };
          }
        } catch (err) {
          logger.warn(`${market} retry ${i + 1} failed: ${err.message}`);
        }
      }
    }

    // retry 全部失敗 → fallback to prev_session
    const prevDate = guard.getPrevTradingDay(market, dateStr);
    logger.warn(`${market} ${dateStr}: all retries failed, fallback to ${prevDate || 'none'}`);

    return {
      action:  'fallback',
      quality: DataQuality.FALLBACK,
      reason:  `API 無資料（交易日），前一交易日 ${prevDate || 'N/A'}`,
      data:    null,
      prevDate
    };
  }

  /**
   * 產生完整的 market context（供 Phase 3/4 使用）
   * @param {string} dateStr
   * @returns {{ twse: object, xnys: object }}
   */
  buildMarketContext(dateStr) {
    const guard = getCalendarGuard();
    return guard.getMarketContext(dateStr);
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let instance = null;
function getFallbackPolicy() {
  if (!instance) instance = new FallbackPolicy();
  return instance;
}

module.exports = { FallbackPolicy, DataQuality, getFallbackPolicy };
