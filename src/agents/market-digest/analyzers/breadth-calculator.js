/**
 * BreadthCalculator — 市場廣度計算器
 *
 * PRIMARY：RSP/SPY ratio → Z-score + percentile_252
 * SECONDARY：9 支 watchlist 近 20 日報酬正比率（每日可用）
 *
 * Breadth State: BROAD(≥80) / HEALTHY(60-79) / MIXED(40-59) / NARROW(20-39) / BROKEN(<20)
 */

'use strict';

const { createLogger } = require('../shared/logger');

const logger = createLogger('analyzer:breadth');

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO'];
const MIN_PRIMARY_POINTS = 200;

class BreadthCalculator {
  /**
   * PRIMARY：RSP/SPY ratio Z-score + percentile（週日 pipeline 用）
   * @param {Array<{date:string, close:number}>} spyHistory - SPY 升冪
   * @param {Array<{date:string, close:number}>} rspHistory - RSP 升冪
   * @returns {{ mode:string, state:string|null, ratio_z20:number|null, ratio_pct252:number|null,
   *             quality_flags:object, degraded:boolean }}
   */
  calculatePrimary(spyHistory, rspHistory) {
    const result = {
      mode: 'NONE',
      state: null,
      ratio_z20: null,
      ratio_pct252: null,
      quality_flags: {},
      degraded: true
    };

    if (!spyHistory?.length || !rspHistory?.length) {
      logger.warn('Primary breadth: SPY or RSP history empty');
      return result;
    }

    // 日期對齊
    const spyMap = new Map(spyHistory.map(r => [r.date, r.close]));
    const rspMap = new Map(rspHistory.map(r => [r.date, r.close]));
    const commonDates = [...spyMap.keys()].filter(d => rspMap.has(d)).sort();

    result.quality_flags.spy_latest_date = spyHistory[spyHistory.length - 1]?.date;
    result.quality_flags.rsp_latest_date = rspHistory[rspHistory.length - 1]?.date;
    result.quality_flags.common_dates = commonDates.length;

    if (commonDates.length < MIN_PRIMARY_POINTS) {
      result.quality_flags.insufficient_lookback_252 = true;
      logger.warn(`Primary breadth: only ${commonDates.length} common dates (need ${MIN_PRIMARY_POINTS})`);
      return result;
    }

    // 計算 ratio 序列
    const ratios = commonDates.map(d => ({
      date: d,
      ratio: rspMap.get(d) / spyMap.get(d)
    }));

    // 最近的 common date 距今天數
    const lastCommonDate = commonDates[commonDates.length - 1];
    const ageDays = Math.floor((Date.now() - new Date(lastCommonDate).getTime()) / 86400000);
    result.quality_flags.common_date = lastCommonDate;
    result.quality_flags.common_date_age_calendar_days = ageDays;

    // MA20 + Std20 + Z-score
    const recent20 = ratios.slice(-20);
    const ratioValues20 = recent20.map(r => r.ratio);
    const ma20 = ratioValues20.reduce((a, b) => a + b, 0) / ratioValues20.length;
    const variance20 = ratioValues20.reduce((s, v) => s + (v - ma20) ** 2, 0) / ratioValues20.length;
    const std20 = Math.sqrt(variance20);

    if (std20 < 1e-10) {
      result.quality_flags.std20_zero = true;
      logger.warn('Primary breadth: std20 is zero');
      return result;
    }

    const currentRatio = ratios[ratios.length - 1].ratio;
    const z20 = (currentRatio - ma20) / std20;
    result.ratio_z20 = z20;

    // Percentile 252（在最近 252 日中的百分位）
    const lookback = Math.min(252, ratios.length);
    const recentRatios = ratios.slice(-lookback).map(r => r.ratio);
    const sorted = [...recentRatios].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= currentRatio).length;
    const pct252 = (rank / sorted.length) * 100;
    result.ratio_pct252 = pct252;

    // Breadth State
    result.state = this._percentileToState(pct252);
    result.mode = 'PRIMARY_RSP_SPY';
    result.degraded = false;

    logger.info(`Primary breadth: state=${result.state}, z20=${z20.toFixed(3)}, pct252=${pct252.toFixed(1)}`);
    return result;
  }

  /**
   * SECONDARY：9 支 watchlist 近 20 日報酬正比率（每日 phase3 用）
   * @param {object} watchlistCloseCache - { AAPL: [{date, close}], ..., _quality: {...} }
   * @returns {{ mode:string, state:string|null, hitRate:number|null, available:number, degraded:boolean }}
   */
  calculateSecondary(watchlistCloseCache) {
    const result = { mode: 'NONE', state: null, hitRate: null, available: 0, degraded: true };

    if (!watchlistCloseCache || typeof watchlistCloseCache !== 'object') {
      return result;
    }

    let positiveCount = 0;
    let totalCount = 0;

    for (const symbol of WATCHLIST) {
      const series = watchlistCloseCache[symbol];
      if (!Array.isArray(series) || series.length < 2) continue;

      // 取最近 20 日報酬
      const recent = series.slice(-21); // 需要 21 筆才有 20 筆報酬
      if (recent.length < 2) continue;

      const returnPct = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;
      if (returnPct > 0) positiveCount++;
      totalCount++;
    }

    result.available = totalCount;

    if (totalCount < 7) {
      logger.warn(`Secondary breadth: only ${totalCount} symbols available (need 7)`);
      return result;
    }

    const hitRate = (positiveCount / totalCount) * 100;
    result.hitRate = hitRate;
    result.state = this._percentileToState(hitRate);
    result.mode = 'SECONDARY_WATCHLIST';
    result.degraded = totalCount < 9; // 7-8 → coverage 降級但仍可用

    logger.info(`Secondary breadth: state=${result.state}, hitRate=${hitRate.toFixed(1)}%, available=${totalCount}`);
    return result;
  }

  /**
   * 百分位 → Breadth State
   */
  _percentileToState(pct) {
    if (pct >= 80) return 'BROAD';
    if (pct >= 60) return 'HEALTHY';
    if (pct >= 40) return 'MIXED';
    if (pct >= 20) return 'NARROW';
    return 'BROKEN';
  }
}

module.exports = { BreadthCalculator };
