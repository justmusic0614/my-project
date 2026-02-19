/**
 * FRED API Collector — 收集美國聯邦儲備經濟數據
 *
 * 資料來源：St. Louis Fed FRED API
 * - Fed Fund Rate (FEDFUNDS series)
 * - High-Yield Spread (BAMLH0A0HYM2 series)
 *
 * API 文件：https://fred.stlouisfed.org/docs/api/fred/
 * API Key：FRED_API_KEY 環境變數（免費，無需付費）
 */

'use strict';

const https = require('https');
const { createLogger } = require('../shared/logger');

const logger = createLogger('collector:fred');

class FredCollector {
  constructor(config = {}) {
    this.apiKey = config.fredApiKey || process.env.FRED_API_KEY;
    this.baseUrl = 'https://api.stlouisfed.org/fred';
  }

  /**
   * 收集 FRED 資料
   * @param {string} date - 日期（YYYY-MM-DD）
   * @returns {Promise<object>} { FED_RATE, HY_SPREAD }
   */
  async collect(date) {
    if (!this.apiKey || this.apiKey.startsWith('${')) {
      logger.warn('FRED_API_KEY not set, skipping FRED collection');
      return {};
    }

    const result = {};

    // Fed Fund Rate (FEDFUNDS series)
    try {
      const observations = await this._fetchSeries('FEDFUNDS', date);
      if (observations && observations.length > 0) {
        const latest = observations[observations.length - 1];
        result.FED_RATE = {
          value: parseFloat(latest.value),
          date: latest.date,
          source: 'fred',
          fetchedAt: new Date().toISOString()
        };
        logger.info(`Fed Fund Rate: ${result.FED_RATE.value}%`);
      }
    } catch (err) {
      logger.error(`Failed to fetch FEDFUNDS: ${err.message}`);
    }

    // High-Yield Spread (BAMLH0A0HYM2 series)
    try {
      const observations = await this._fetchSeries('BAMLH0A0HYM2', date);
      if (observations && observations.length > 0) {
        const latest = observations[observations.length - 1];
        result.HY_SPREAD = {
          value: parseFloat(latest.value),
          date: latest.date,
          source: 'fred',
          fetchedAt: new Date().toISOString()
        };
        logger.info(`High-Yield Spread: ${result.HY_SPREAD.value}%`);
      }
    } catch (err) {
      logger.error(`Failed to fetch HY_SPREAD: ${err.message}`);
    }

    return result;
  }

  /**
   * 從 FRED API 取得時間序列資料
   * @param {string} seriesId - FRED 系列 ID
   * @param {string} endDate - 結束日期（YYYY-MM-DD）
   * @returns {Promise<Array>} observations
   */
  async _fetchSeries(seriesId, endDate) {
    return new Promise((resolve, reject) => {
      // 取得最新一筆資料（limit=1, sort_order=desc）
      const url = `${this.baseUrl}/series/observations?series_id=${seriesId}&api_key=${this.apiKey}&file_type=json&limit=1&sort_order=desc`;

      logger.info(`Fetching FRED series: ${seriesId}`);
      const req = https.get(url, (res) => {
        logger.info(`FRED response received for ${seriesId}: status=${res.statusCode}`);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error_code) {
              reject(new Error(`FRED API error: ${json.error_message}`));
            } else {
              resolve(json.observations || []);
            }
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);

      // 設定 10 秒超時
      req.setTimeout(10000, () => {
        logger.warn(`FRED API timeout for ${seriesId} (10s)`);
        req.destroy();
        reject(new Error(`FRED API timeout for ${seriesId}`));
      });
    });
  }
}

module.exports = { FredCollector };
