/**
 * KeyLevelsEngine — 關鍵位階計算引擎
 *
 * SPX：support [MA20, MA50, rolling_low_10d], resistance [rolling_high_10d, rolling_high_20d]
 * TAIEX：support [MA20, MA60], resistance [rolling_high_20d]
 * ATR14：首版 = null（SQLite 無 OHLCV，Phase B 再加）
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('analyzer:key-levels');

class KeyLevelsEngine {
  /**
   * 計算關鍵位階
   * @param {Array<{date:string, close:number}>} spxHistory - SP500 升冪（至少 60 筆）
   * @param {Array<{date:string, close:number}>} taiexHistory - TAIEX 升冪（至少 60 筆）
   * @returns {{ spx: object|null, taiex: object|null }}
   */
  calculate(spxHistory, taiexHistory) {
    return {
      spx:   this._calcSpx(spxHistory),
      taiex: this._calcTaiex(taiexHistory)
    };
  }

  _calcSpx(history) {
    if (!history || history.length < 50) {
      logger.warn(`SPX key-levels: insufficient data (${history?.length || 0} bars)`);
      return null;
    }

    const closes = history.map(r => r.close);
    const current = closes[closes.length - 1];

    // MA
    const ma20 = this._ma(closes, 20);
    const ma50 = this._ma(closes, 50);
    const ma200 = closes.length >= 200 ? this._ma(closes, 200) : null;

    // Rolling high/low
    const last10 = closes.slice(-10);
    const last20 = closes.slice(-20);
    const high10d = Math.max(...last10);
    const high20d = Math.max(...last20);
    const low10d = Math.min(...last10);

    const support = [
      { label: 'MA20', value: ma20 },
      { label: 'MA50', value: ma50 },
      { label: '10D_LOW', value: low10d }
    ].filter(s => s.value != null).sort((a, b) => b.value - a.value);

    const resistance = [
      { label: '10D_HIGH', value: high10d },
      { label: '20D_HIGH', value: high20d }
    ].sort((a, b) => a.value - b.value);

    if (ma200 != null) {
      support.push({ label: 'MA200', value: ma200 });
      support.sort((a, b) => b.value - a.value);
    }

    return {
      current,
      ma20, ma50, ma200,
      support,
      resistance,
      atr14: null, // Phase B 再加（需 OHLCV）
      date: history[history.length - 1].date
    };
  }

  _calcTaiex(history) {
    if (!history || history.length < 60) {
      logger.warn(`TAIEX key-levels: insufficient data (${history?.length || 0} bars)`);
      return null;
    }

    const closes = history.map(r => r.close);
    const current = closes[closes.length - 1];

    const ma20 = this._ma(closes, 20);
    const ma60 = this._ma(closes, 60);
    const last20 = closes.slice(-20);
    const high20d = Math.max(...last20);

    const support = [
      { label: 'MA20', value: ma20 },
      { label: 'MA60', value: ma60 }
    ].sort((a, b) => b.value - a.value);

    const resistance = [
      { label: '20D_HIGH', value: high20d }
    ];

    return {
      current,
      ma20, ma60,
      support,
      resistance,
      date: history[history.length - 1].date
    };
  }

  _ma(closes, period) {
    if (closes.length < period) return null;
    const slice = closes.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }
}

module.exports = { KeyLevelsEngine };
