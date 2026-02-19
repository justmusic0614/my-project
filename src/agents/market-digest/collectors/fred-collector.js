/**
 * FRED API Collector — 收集美國聯邦儲備經濟數據
 *
 * 繼承 BaseCollector，自動獲得：
 *   - Circuit Breaker（失敗 5 次自動熔斷）
 *   - withRetry（指數退避重試 3 次）
 *   - withCache（30 分鐘正常快取）
 *   - 7 天 stale fallback（失敗時使用前日快取 + DELAYED 標記）
 *   - 結構化日誌
 *   - 標準化 MarketDataPoint 輸出
 *
 * 資料來源：St. Louis Fed FRED API
 * - Fed Fund Rate (FEDFUNDS series)
 * - High-Yield Spread (BAMLH0A0HYM2 series)
 *
 * API 文件：https://fred.stlouisfed.org/docs/api/fred/
 * API Key：FRED_API_KEY 環境變數（免費）
 *
 * 注意：使用 execSync('curl') 而非 Node.js https 模組，
 * 因為 VPS 環境下 https.get() 無法連線 FRED API。
 */

'use strict';

const { execSync } = require('child_process');
const BaseCollector = require('./base-collector');
const { getApiKeys } = require('../shared/api-keys');

const CACHE_TTL       = 30 * 60 * 1000;           // 30 分鐘（正常快取）
const STALE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;  // 7 天（stale fallback）

const SERIES = {
  FED_RATE:   'FEDFUNDS',
  HY_SPREAD:  'BAMLH0A0HYM2'
};

class FredCollector extends BaseCollector {
  constructor(config = {}) {
    super('fred', config);
    this.apiKey = getApiKeys().getFred();
    this.baseUrl = 'https://api.stlouisfed.org/fred';
  }

  /**
   * 收集 FRED 資料（帶快取 + 重試 + Circuit Breaker）
   * @param {string} [date] - 日期（YYYY-MM-DD），預設今天
   * @returns {Promise<object>} { FED_RATE, HY_SPREAD } — 標準化 MarketDataPoint
   */
  async collect(date) {
    if (!this.apiKey) {
      this.logger.warn('FRED_API_KEY not set, skipping');
      return {};
    }

    const today = date || new Date().toISOString().slice(0, 10);
    const cacheKey = `fred-daily-${today}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      const result = {};

      for (const [field, seriesId] of Object.entries(SERIES)) {
        try {
          const point = await this.withRetry(
            () => this._fetchAndMakePoint(seriesId, field),
            3,
            // Circuit Breaker 開路或 3 次重試失敗後，使用 stale fallback
            () => this._getStaleFallback(field)
          );
          if (point) {
            result[field] = point;
          }
        } catch (err) {
          this.logger.error(`${field} collection failed: ${err.message}`);
          // 最後嘗試 stale fallback
          const stale = this._getStaleFallback(field);
          if (stale) result[field] = stale;
        }
      }

      // 成功收集的資料存入 stale cache（供未來 fallback 使用）
      this._saveStaleCache(result);
      return result;
    });
  }

  /**
   * 從 FRED API 取得資料並轉為標準化 MarketDataPoint
   */
  async _fetchAndMakePoint(seriesId, fieldName) {
    const url = `${this.baseUrl}/series/observations?series_id=${seriesId}&api_key=${this.apiKey}&file_type=json&limit=1&sort_order=desc`;

    this.logger.info(`Fetching FRED series: ${seriesId}`);
    const raw = execSync(`curl -s -m 10 "${url}"`, { encoding: 'utf8', maxBuffer: 1024 * 1024 });

    const json = JSON.parse(raw);
    if (json.error_code) {
      throw new Error(`FRED API: ${json.error_message}`);
    }

    const obs = json.observations || [];
    if (obs.length === 0) {
      this.logger.warn(`No observations for ${seriesId}`);
      return null;
    }

    const value = parseFloat(obs[0].value);
    if (isNaN(value)) {
      this.logger.warn(`Invalid value for ${seriesId}: ${obs[0].value}`);
      return null;
    }

    this.logger.info(`${fieldName}: ${value}%`);
    const point = this.makeDataPoint(value, { source: 'fred' });
    point.date = obs[0].date;
    return point;
  }

  /**
   * 從 stale cache 讀取前日資料（7 天 TTL）
   * 回傳帶 DELAYED 降級標記的 MarketDataPoint
   */
  _getStaleFallback(field) {
    const cached = this.cache.get(`fred-stale-${field}`, STALE_CACHE_TTL);
    if (cached) {
      this.logger.warn(`Using stale fallback for ${field} (value: ${cached.value})`);
      return this.makeDelayedDataPoint(cached.value, { source: 'fred-stale' });
    }
    this.logger.warn(`No stale cache available for ${field}`);
    return null;
  }

  /**
   * 將成功收集的資料存入 stale cache（供未來 fallback）
   * 只存非 DELAYED 的資料（避免 stale → stale 累積）
   */
  _saveStaleCache(result) {
    for (const [key, point] of Object.entries(result)) {
      if (point?.value != null && point.degraded !== 'DELAYED') {
        this.cache.set(`fred-stale-${key}`, { value: point.value });
      }
    }
  }
}

module.exports = { FredCollector };
