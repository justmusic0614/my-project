/**
 * test-e2e-pipeline.js — E2E Pipeline 資料流測試
 *
 * 使用 mock 資料驗證完整 pipeline 資料流：
 *   - 關鍵欄位傳遞（Phase 1 → Phase 3 → Validator）
 *   - Phase Output Schema 驗證
 *   - FRED 失敗降級為 stale + DELAYED 標記
 *   - 補充欄位缺失只 warn 不 abort
 *   - Lineage Tracker 異常偵測
 *
 * 執行：node --test test/test-e2e-pipeline.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock 資料 ──────────────────────────────────────────────────────────────

function _makePoint(value, source = 'fmp') {
  return {
    value,
    changePct: 0.5,
    source,
    fetchedAt: new Date().toISOString(),
    verified: false,
    degraded: ''
  };
}

const MOCK_FMP = {
  SP500:  _makePoint(5200, 'fmp'),
  NASDAQ: _makePoint(16500, 'fmp'),
  DJI:    _makePoint(39200, 'fmp'),
  VIX:    _makePoint(15.3, 'fmp'),
  DXY:    _makePoint(106.5, 'fmp'),
  US10Y:  _makePoint(4.35, 'fmp')
};

const MOCK_YAHOO = {
  USDTWD:  _makePoint(31.5, 'yahoo'),
  GOLD:    _makePoint(2050, 'yahoo'),
  OIL_WTI: _makePoint(78.5, 'yahoo'),
  COPPER:  _makePoint(4.2, 'yahoo'),
  BTC:     _makePoint(52000, 'yahoo')
};

const MOCK_FRED = {
  FED_RATE:  _makePoint(5.33, 'fred'),
  HY_SPREAD: _makePoint(3.45, 'fred')
};

// ─── 1. 關鍵欄位傳遞測試 ───────────────────────────────────────────────────

describe('E2E: 關鍵欄位傳遞', () => {
  test('Validator 接收完整 mock 資料時，所有關鍵欄位有值', () => {
    const validator = require('../processors/validator');
    const collectedData = {
      fmp: MOCK_FMP,
      yahoo: MOCK_YAHOO,
      fred: MOCK_FRED,
      twse: null,
      finmind: null
    };

    const { marketData } = validator.validate(collectedData);

    const criticalFields = ['SP500', 'NASDAQ', 'DJI', 'VIX', 'USDTWD', 'GOLD', 'OIL_WTI', 'BTC'];
    for (const field of criticalFields) {
      assert.ok(marketData[field], `關鍵欄位 ${field} 應存在`);
      assert.ok(marketData[field].value != null, `關鍵欄位 ${field} 值不應為 null`);
      assert.notEqual(marketData[field].degraded, 'NA', `關鍵欄位 ${field} 不應為 NA`);
    }
  });

  test('FRED 資料正確傳遞到 Validator', () => {
    const validator = require('../processors/validator');
    const collectedData = {
      fmp: MOCK_FMP,
      yahoo: MOCK_YAHOO,
      fred: MOCK_FRED,
      twse: null,
      finmind: null
    };

    const { marketData } = validator.validate(collectedData);

    assert.ok(marketData.FED_RATE?.value != null, 'FED_RATE 應有值');
    assert.equal(marketData.FED_RATE.value, 5.33, 'FED_RATE 值應為 5.33');
    assert.ok(marketData.HY_SPREAD?.value != null, 'HY_SPREAD 應有值');
    assert.equal(marketData.HY_SPREAD.value, 3.45, 'HY_SPREAD 值應為 3.45');
  });
});

// ─── 2. Phase Output Schema 驗證 ──────────────────────────────────────────

describe('E2E: Phase Output Schema 驗證', () => {
  const { validate, CRITICAL_FIELDS } = require('../shared/schemas/daily-brief.schema');

  test('Phase 1 正常輸出通過驗證', () => {
    const phase1Output = {
      phase: 'phase1',
      date: '2026-02-20',
      collectedAt: new Date().toISOString(),
      fmp: MOCK_FMP,
      yahoo: MOCK_YAHOO,
      secEdgar: { filings: [] },
      fred: MOCK_FRED
    };

    const result = validate.phaseOutput('phase1', phase1Output);
    assert.ok(result.valid, `Phase 1 驗證失敗：${result.errors.join('; ')}`);
    assert.equal(result.abortPipeline, false);
  });

  test('Phase 1 缺少 fred 源記錄 error', () => {
    const phase1Output = {
      phase: 'phase1',
      date: '2026-02-20',
      collectedAt: new Date().toISOString(),
      fmp: MOCK_FMP,
      yahoo: MOCK_YAHOO,
      secEdgar: { filings: [] },
      fred: null  // 缺失
    };

    const result = validate.phaseOutput('phase1', phase1Output);
    assert.ok(result.errors.some(e => e.includes("source 'fred' is null")), '應報告 fred 缺失');
  });

  test('Phase 3 全部關鍵欄位缺失觸發 abortPipeline', () => {
    const naPoint = { value: null, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString() };
    const phase3Output = {
      phase: 'phase3',
      date: '2026-02-20',
      processedAt: new Date().toISOString(),
      marketData: {
        date: '2026-02-20',
        SP500: naPoint, NASDAQ: naPoint, DJI: naPoint, VIX: naPoint,
        USDTWD: naPoint, GOLD: naPoint, OIL_WTI: naPoint, BTC: naPoint
      },
      validationReport: { degradedFields: [], schemaErrors: [], crossCheckWarnings: [], reasonabilityWarnings: [] }
    };

    const result = validate.phaseOutput('phase3', phase3Output);
    assert.ok(result.abortPipeline, '全部關鍵欄位缺失應觸發 abort');
    assert.equal(result.missingCritical.length, CRITICAL_FIELDS.length);
  });

  test('Phase 3 部分關鍵欄位缺失不 abort', () => {
    const naPoint = { value: null, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString() };
    const phase3Output = {
      phase: 'phase3',
      date: '2026-02-20',
      processedAt: new Date().toISOString(),
      marketData: {
        date: '2026-02-20',
        SP500: _makePoint(5200), NASDAQ: _makePoint(16500), DJI: _makePoint(39200),
        VIX: _makePoint(15.3), USDTWD: _makePoint(31.5), GOLD: _makePoint(2050),
        OIL_WTI: naPoint,  // 只有 1 個缺失
        BTC: _makePoint(52000)
      },
      validationReport: { degradedFields: [], schemaErrors: [], crossCheckWarnings: [], reasonabilityWarnings: [] }
    };

    const result = validate.phaseOutput('phase3', phase3Output);
    assert.equal(result.abortPipeline, false, '部分缺失不應 abort');
    assert.equal(result.missingCritical.length, 1, '應有 1 個關鍵欄位缺失');
    assert.ok(result.missingCritical.includes('OIL_WTI'));
  });

  test('Phase 3 補充欄位缺失被正確記錄', () => {
    const phase3Output = {
      phase: 'phase3',
      date: '2026-02-20',
      processedAt: new Date().toISOString(),
      marketData: {
        date: '2026-02-20',
        SP500: _makePoint(5200), NASDAQ: _makePoint(16500), DJI: _makePoint(39200),
        VIX: _makePoint(15.3), USDTWD: _makePoint(31.5), GOLD: _makePoint(2050),
        OIL_WTI: _makePoint(78.5), BTC: _makePoint(52000),
        // 補充欄位全部缺失
        FED_RATE: { value: null, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString() },
        HY_SPREAD: { value: null, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString() }
      },
      validationReport: { degradedFields: [], schemaErrors: [], crossCheckWarnings: [], reasonabilityWarnings: [] }
    };

    const result = validate.phaseOutput('phase3', phase3Output);
    assert.equal(result.abortPipeline, false, '補充欄位缺失不應 abort');
    assert.ok(result.missingSupplementary.includes('FED_RATE'), 'FED_RATE 應記錄為缺失');
    assert.ok(result.missingSupplementary.includes('HY_SPREAD'), 'HY_SPREAD 應記錄為缺失');
  });

  test('null 輸出觸發 abort', () => {
    const result = validate.phaseOutput('phase3', null);
    assert.ok(result.abortPipeline, 'null 輸出應觸發 abort');
  });
});

// ─── 3. FRED 失敗降級測試 ──────────────────────────────────────────────────

describe('E2E: FRED 失敗降級', () => {
  test('makeDelayedDataPoint 產生 DELAYED 標記', () => {
    const BaseCollector = require('../collectors/base-collector');
    // BaseCollector 需要 name 和 config
    const bc = new BaseCollector('test-delayed', {});

    const stalePoint = bc.makeDelayedDataPoint(5.33, { source: 'fred-stale' });
    assert.equal(stalePoint.degraded, 'DELAYED', '應為 DELAYED');
    assert.equal(stalePoint.value, 5.33, '值應為 5.33');
    assert.equal(stalePoint.source, 'fred-stale');
  });

  test('FRED 失敗時 Validator 將 FED_RATE/HY_SPREAD 標為 NA', () => {
    const validator = require('../processors/validator');
    const collectedData = {
      fmp: MOCK_FMP,
      yahoo: MOCK_YAHOO,
      fred: {},  // FRED 完全失敗
      twse: null,
      finmind: null
    };

    const { marketData, validationReport } = validator.validate(collectedData);

    // FRED 欄位應為 NA
    assert.equal(marketData.FED_RATE?.degraded, 'NA', 'FED_RATE 應為 NA');
    assert.equal(marketData.HY_SPREAD?.degraded, 'NA', 'HY_SPREAD 應為 NA');
    assert.ok(validationReport.degradedFields.includes('FED_RATE'), 'FED_RATE 應在降級清單');
    assert.ok(validationReport.degradedFields.includes('HY_SPREAD'), 'HY_SPREAD 應在降級清單');

    // 關鍵欄位仍正常
    assert.ok(marketData.SP500.value != null, 'SP500 不受 FRED 影響');
    assert.ok(marketData.NASDAQ.value != null, 'NASDAQ 不受 FRED 影響');
  });
});

// ─── 4. Lineage Tracker 異常偵測 ──────────────────────────────────────────

describe('E2E: Lineage Tracker', () => {
  const { LineageTracker } = require('../sre/lineage-tracker');

  test('正常資料流無異常', () => {
    const tracker = new LineageTracker('2026-02-20');
    tracker.record('phase1', 'SP500', { value: 5200, source: 'fmp' });
    tracker.record('phase3', 'SP500', { value: 5200, source: 'fmp', degraded: '' });

    const anomalies = tracker.detectAnomalies();
    assert.equal(anomalies.length, 0, '正常資料流不應有異常');
  });

  test('偵測 value_dropped：Phase 1 有值 → Phase 3 無值', () => {
    const tracker = new LineageTracker('2026-02-20');
    tracker.record('phase1', 'SP500', { value: 5200, source: 'fmp' });
    tracker.record('phase3', 'SP500', { value: null, source: 'none', degraded: 'NA' });

    const anomalies = tracker.detectAnomalies();
    assert.ok(anomalies.length > 0, '應偵測到異常');
    assert.ok(anomalies.some(a => a.field === 'SP500' && a.type === 'value_dropped'),
      '應偵測到 SP500 value_dropped');
  });

  test('偵測 degradation_added：Phase 1 正常 → Phase 3 降級', () => {
    const tracker = new LineageTracker('2026-02-20');
    tracker.record('phase1', 'FED_RATE', { value: 5.33, source: 'fred', degraded: '' });
    tracker.record('phase3', 'FED_RATE', { value: 5.33, source: 'fred', degraded: 'DELAYED' });

    const anomalies = tracker.detectAnomalies();
    assert.ok(anomalies.some(a => a.field === 'FED_RATE' && a.type === 'degradation_added'),
      '應偵測到 FED_RATE degradation_added');
  });

  test('recordMarketData 批次記錄所有追蹤欄位', () => {
    const tracker = new LineageTracker('2026-02-20');
    const mockMarketData = {
      SP500: _makePoint(5200, 'fmp'),
      FED_RATE: _makePoint(5.33, 'fred')
    };

    tracker.recordMarketData('phase1', mockMarketData);

    // SP500 和 FED_RATE 應被記錄
    assert.ok(tracker.entries.SP500, 'SP500 應有記錄');
    assert.ok(tracker.entries.FED_RATE, 'FED_RATE 應有記錄');
    assert.equal(tracker.entries.SP500[0].value, 5200);
    assert.equal(tracker.entries.FED_RATE[0].value, 5.33);

    // 未提供的欄位應記錄為 missing
    assert.ok(tracker.entries.NASDAQ, 'NASDAQ 應有記錄（即使不存在）');
    assert.equal(tracker.entries.NASDAQ[0].value, null, '缺失欄位值應為 null');
    assert.equal(tracker.entries.NASDAQ[0].source, 'missing');
  });
});
