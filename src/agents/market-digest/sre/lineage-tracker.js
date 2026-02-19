/**
 * LineageTracker — 資料血統追蹤
 *
 * 記錄每個市場欄位在 Pipeline 各 phase 的來源、值、降級狀態。
 * 用於偵測資料在 phase 間消失或降級的異常情況。
 *
 * 輸出：data/pipeline-state/lineage-YYYY-MM-DD.json
 *
 * 使用方式：
 *   const tracker = new LineageTracker('2026-02-20');
 *   tracker.recordMarketData('phase1', phase1Result.marketData);
 *   tracker.recordMarketData('phase3', phase3Result.marketData);
 *   const report = tracker.save();
 *   // report.anomalies → [{ field, type, from, to }]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger } = require('../shared/logger');

const logger = createLogger('sre:lineage');
const STATE_DIR = path.join(__dirname, '../data/pipeline-state');

// 追蹤的市場欄位
const TRACKED_FIELDS = [
  'TAIEX', 'SP500', 'NASDAQ', 'DJI', 'USDTWD', 'VIX',
  'DXY', 'US10Y', 'FED_RATE', 'HY_SPREAD',
  'GOLD', 'OIL_WTI', 'COPPER', 'BTC', 'PUT_CALL_RATIO'
];

class LineageTracker {
  /**
   * @param {string} [date] - 日期（YYYY-MM-DD），預設今天
   */
  constructor(date) {
    this.date = date || new Date().toISOString().slice(0, 10);
    this.entries = {};   // { fieldName: [{ phase, source, value, degraded, timestamp }] }
    this.anomalies = [];
  }

  /**
   * 記錄單一欄位在某 phase 的狀態
   * @param {string} phase - 'phase1' | 'phase2' | 'phase3' | 'phase4'
   * @param {string} field - 'SP500' | 'FED_RATE' | etc.
   * @param {object} info  - { value, source, degraded, fromCache }
   */
  record(phase, field, info = {}) {
    if (!this.entries[field]) this.entries[field] = [];
    this.entries[field].push({
      phase,
      value:     info.value ?? null,
      source:    info.source || 'unknown',
      degraded:  info.degraded || '',
      fromCache: info.fromCache || false,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 批次記錄 marketData 物件中所有追蹤欄位
   * @param {string} phase - 'phase1' | 'phase3'
   * @param {object} marketData - { SP500: { value, source, degraded, ... }, ... }
   */
  recordMarketData(phase, marketData) {
    if (!marketData || typeof marketData !== 'object') return;

    for (const field of TRACKED_FIELDS) {
      const point = marketData[field];
      if (point && typeof point === 'object') {
        this.record(phase, field, {
          value:     point.value,
          source:    point.source,
          degraded:  point.degraded || '',
          fromCache: point._fromCache || false
        });
      } else {
        // 欄位不存在也記錄（方便偵測缺失）
        this.record(phase, field, { value: null, source: 'missing', degraded: 'NA' });
      }
    }
  }

  /**
   * 偵測異常：值消失、降級標記新增
   * @returns {Array<{ field, type, from, to }>}
   */
  detectAnomalies() {
    this.anomalies = [];

    for (const [field, history] of Object.entries(this.entries)) {
      if (history.length < 2) continue;

      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];

        // 值消失：前一 phase 有值，目前 phase 無值
        if (prev.value != null && curr.value == null) {
          this.anomalies.push({
            field,
            type: 'value_dropped',
            from: { phase: prev.phase, value: prev.value, source: prev.source },
            to:   { phase: curr.phase, value: null, source: curr.source }
          });
        }

        // 降級標記新增：前一 phase 無降級，目前 phase 有降級
        if (!prev.degraded && curr.degraded && curr.degraded !== '') {
          this.anomalies.push({
            field,
            type: 'degradation_added',
            from: { phase: prev.phase, degraded: '' },
            to:   { phase: curr.phase, degraded: curr.degraded }
          });
        }
      }
    }

    return this.anomalies;
  }

  /**
   * 儲存 lineage 報告到磁碟
   * @returns {object} { date, fieldCount, anomalyCount, entries, anomalies }
   */
  save() {
    this._ensureDir(STATE_DIR);

    const anomalies = this.detectAnomalies();
    const report = {
      date:         this.date,
      generatedAt:  new Date().toISOString(),
      fieldCount:   Object.keys(this.entries).length,
      anomalyCount: anomalies.length,
      entries:      this.entries,
      anomalies
    };

    const filePath = path.join(STATE_DIR, `lineage-${this.date}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');

    logger.info(`lineage saved: ${filePath}`, {
      fields: report.fieldCount,
      anomalies: report.anomalyCount
    });

    if (anomalies.length > 0) {
      logger.warn(`${anomalies.length} lineage anomalies detected`, {
        anomalies: anomalies.map(a => `${a.field}:${a.type}`)
      });
    }

    return report;
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { LineageTracker, TRACKED_FIELDS };
