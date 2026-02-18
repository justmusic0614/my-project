/**
 * Validator — 資料驗證處理器
 * Phase 3 第一步：整合 Phase 1+2 收集結果，執行三層驗證
 *
 * 三層驗證：
 *   Layer 1: Schema 驗證（必填欄位、型別）
 *   Layer 2: 合理性門檻（數值範圍 + 單日變幅）
 *   Layer 3: 多源交叉比對（容差確認）
 *
 * 失敗策略：
 *   - 單一欄位失敗 → 標記降級 [DELAYED]/[UNVERIFIED]/N/A，不阻塞流程
 *   - 完全無數據 → 降級推播 + 告警
 */

'use strict';

const { validate, THRESHOLDS, DEGRADATION_LABELS } = require('../shared/schemas/daily-brief.schema');
const { createLogger } = require('../shared/logger');

const logger = createLogger('processor:validator');

// 交叉比對容差（%，小數）— 與 config.json validation.crossCheck 對齊
const CROSS_CHECK_TOLERANCE = {
  TAIEX:  0.005,  // TWSE vs FinMind 0.5%
  SP500:  0.003,  // FMP vs Yahoo 0.3%
  NASDAQ: 0.003,
  USDTWD: 0.005
};

class Validator {
  /**
   * 主驗證方法
   * 輸入：Phase 1+2 收集結果的彙整物件
   * 輸出：標準化 + 驗證後的 marketData 物件，帶降級標記
   *
   * @param {object} collectedData - { twse, fmp, finmind, yahoo, rss, sec, perplexity }
   * @returns {{ marketData, validationReport, hasErrors }}
   */
  validate(collectedData) {
    const { twse, fmp, finmind, yahoo } = collectedData;

    const marketData = { date: this._today() };
    const report = {
      schemaErrors: [],
      reasonabilityWarnings: [],
      crossCheckWarnings: [],
      degradedFields: []
    };

    // ── Layer 1+2: 合理性驗證並建立 marketData ──────────────────────────────

    // TAIEX（主：TWSE，交叉：FinMind）
    marketData.TAIEX = this._mergeDataPoint('TAIEX', [
      twse?.TAIEX,
      finmind?.TAIEX
    ], CROSS_CHECK_TOLERANCE.TAIEX, report);

    // SP500（主：FMP，交叉：Yahoo）
    marketData.SP500 = this._mergeDataPoint('SP500', [
      fmp?.SP500,
      yahoo?.SP500
    ], CROSS_CHECK_TOLERANCE.SP500, report);

    // NASDAQ（主：FMP，交叉：Yahoo）
    marketData.NASDAQ = this._mergeDataPoint('NASDAQ', [
      fmp?.NASDAQ,
      yahoo?.NASDAQ
    ], CROSS_CHECK_TOLERANCE.NASDAQ, report);

    // DJI（主：FMP）
    marketData.DJI = this._pickBest('DJI', [fmp?.DJI, yahoo?.DJI], report);

    // USD/TWD（主：TWSE，交叉：Yahoo）
    marketData.USDTWD = this._mergeDataPoint('USDTWD', [
      null, // TWSE 可能不含匯率
      yahoo?.USDTWD
    ], CROSS_CHECK_TOLERANCE.USDTWD, report);

    // VIX（主：FMP）
    marketData.VIX = this._pickBest('VIX', [fmp?.VIX, yahoo?.VIX], report);

    // DXY（主：FMP）
    marketData.DXY = this._pickBest('DXY', [fmp?.DXY], report);

    // US 10Y（主：FMP）
    marketData.US10Y = this._pickBest('US10Y', [fmp?.US10Y], report);

    // 大宗商品（Yahoo）
    for (const key of ['GOLD', 'OIL_WTI', 'COPPER', 'BTC']) {
      marketData[key] = this._pickBest(key, [yahoo?.[key]], report);
    }

    // 台股法人、融資融券、成交量（TWSE）
    if (twse?.institutional) marketData.institutional = twse.institutional;
    if (twse?.margin)         marketData.margin        = twse.margin;
    if (twse?.taiexVolume)    marketData.taiexVolume   = twse.taiexVolume;

    // ── Layer 1: 最終 DailyBriefData Schema 驗證 ────────────────────────────
    const schemaResult = validate.dailyBriefData({
      date: marketData.date,
      marketData
    });

    if (!schemaResult.valid) {
      report.schemaErrors.push(...schemaResult.errors);
    }
    report.reasonabilityWarnings.push(...(schemaResult.warnings || []));

    const degradedCount = report.degradedFields.length;
    const hasErrors = report.schemaErrors.length > 0;

    logger.info('validation complete', {
      degraded:  degradedCount,
      schemaErrors: report.schemaErrors.length,
      crossCheckWarnings: report.crossCheckWarnings.length,
      reasonabilityWarnings: report.reasonabilityWarnings.length
    });

    if (degradedCount > 0) {
      logger.warn(`${degradedCount} fields degraded: ${report.degradedFields.join(', ')}`);
    }

    return { marketData, validationReport: report, hasErrors };
  }

  /**
   * 多源合併：取最佳值 + 交叉比對
   * @param {string} key - 欄位名稱（用於門檻查詢）
   * @param {object[]} points - 多個 MarketDataPoint（按優先級排序，第一個為主）
   * @param {number} tolerance - 交叉比對容差（小數）
   * @param {object} report
   */
  _mergeDataPoint(key, points, tolerance, report) {
    const valid = points.filter(p => p && p.value != null && p.degraded !== 'NA');

    if (valid.length === 0) {
      report.degradedFields.push(key);
      return { value: null, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString() };
    }

    const primary = valid[0];

    // Layer 2: 合理性檢查
    const reasonCheck = validate.marketDataPoint(key, primary);
    if (!reasonCheck.valid) {
      report.reasonabilityWarnings.push(...reasonCheck.errors);
      // 單日變幅超出 → UNVERIFIED（不阻止使用）
      if (reasonCheck.errors.some(e => e.includes('單日變幅'))) {
        primary.degraded = 'UNVERIFIED';
        report.degradedFields.push(`${key}(UNVERIFIED)`);
      }
    }

    // Layer 3: 交叉比對（需要第二個來源）
    if (valid.length >= 2 && tolerance != null) {
      const secondary = valid[1];
      const ok = validate.crossCheck(primary.value, secondary.value, tolerance);
      if (!ok) {
        const diff = Math.abs(primary.value - secondary.value);
        const pct  = ((diff / Math.max(primary.value, secondary.value)) * 100).toFixed(2);
        report.crossCheckWarnings.push(
          `${key} 交叉比對失敗：${primary.source}=${primary.value} vs ${secondary.source}=${secondary.value}（差異 ${pct}% > ${(tolerance * 100).toFixed(1)}%）`
        );
        primary.degraded = 'UNVERIFIED';
        if (!report.degradedFields.includes(`${key}(UNVERIFIED)`)) {
          report.degradedFields.push(`${key}(UNVERIFIED)`);
        }
      } else {
        primary.verified = true;
      }
    }

    return primary;
  }

  /**
   * 單源選最佳（有值 + 合理性通過）
   */
  _pickBest(key, points, report) {
    const valid = points.filter(p => p && p.value != null && p.degraded !== 'NA');
    if (valid.length === 0) {
      report.degradedFields.push(key);
      return { value: null, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString() };
    }

    const pt = valid[0];

    // 合理性檢查（非嚴格，只記錄）
    const check = validate.marketDataPoint(key, pt);
    if (!check.valid) {
      report.reasonabilityWarnings.push(...check.errors);
      if (check.errors.some(e => e.includes('單日變幅'))) {
        pt.degraded = 'UNVERIFIED';
      }
    }

    return pt;
  }

  /**
   * 驗證新聞陣列（篩除格式異常的條目）
   * @param {object[]} newsArray
   * @returns {{ valid: NewsItem[], invalid: object[] }}
   */
  validateNews(newsArray) {
    if (!Array.isArray(newsArray)) return { valid: [], invalid: [] };

    const valid = [];
    const invalid = [];

    for (const item of newsArray) {
      if (!item.title || typeof item.title !== 'string' || item.title.length < 5) {
        invalid.push({ item, reason: 'title_too_short' });
        continue;
      }
      if (!item.source) {
        invalid.push({ item, reason: 'missing_source' });
        continue;
      }
      valid.push(item);
    }

    return { valid, invalid };
  }

  /**
   * 驗證 SEC 申報陣列
   */
  validateSecFilings(filings) {
    if (!Array.isArray(filings)) return { valid: [], invalid: [] };

    const valid = filings.filter(f => f.formType && f.company && f.filedAt);
    const invalid = filings.filter(f => !f.formType || !f.company || !f.filedAt);

    return { valid, invalid };
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }
}

// 單例
const validator = new Validator();

module.exports = validator;
module.exports.Validator = Validator;
