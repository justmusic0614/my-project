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
      vix: await this._updateSeries('vix', date, marketData.VIX?.value),
      us10y: await this._updateSeries('us10y', date, marketData.US10Y?.value),
      dxy: await this._updateSeries('dxy', date, marketData.DXY?.value),
      putCallRatio: await this._updateSeries('put-call-ratio', date, marketData.PUT_CALL_RATIO?.value),
      spyVolume: await this._updateSeries('spy-volume', date, marketData.SPY_VOLUME?.current)
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

    // 保留最近 30 天
    if (data.length > 30) {
      data = data.slice(-30);
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
    if (history.vix && history.vix.length > 0) {
      result.vix = {
        current: history.vix[history.vix.length - 1].value,
        avg5Day: this._calculateMA(history.vix, 5),
        avg10Day: this._calculateMA(history.vix, 10)
      };
    }

    // US10Y：當前值 + 5日均線
    if (history.us10y && history.us10y.length > 0) {
      result.us10y = {
        current: history.us10y[history.us10y.length - 1].value,
        avg5Day: this._calculateMA(history.us10y, 5)
      };
    }

    // DXY：當前值 + 5日均線
    if (history.dxy && history.dxy.length > 0) {
      result.dxy = {
        current: history.dxy[history.dxy.length - 1].value,
        avg5Day: this._calculateMA(history.dxy, 5)
      };
    }

    // Put/Call Ratio：當前值 + 10日均線
    if (history.putCallRatio && history.putCallRatio.length > 0) {
      result.putCallRatio = {
        current: history.putCallRatio[history.putCallRatio.length - 1].value,
        avg10Day: this._calculateMA(history.putCallRatio, 10)
      };
    }

    // SPY Volume：當前值 + 20日均線
    if (history.spyVolume && history.spyVolume.length > 0) {
      result.spyVolume = {
        current: history.spyVolume[history.spyVolume.length - 1].value,
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
}

module.exports = { MarketHistoryManager };
