/**
 * test-validators.js — Schema 與驗證邏輯單元測試
 * 測試 daily-brief.schema.js 的驗證函數
 *
 * 執行：node --test test/test-validators.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../shared/schemas/daily-brief.schema.js');
const { validate, THRESHOLDS, DEGRADATION_LABELS, IMPORTANCE_LEVELS } = schema;

// ─── 常數匯出測試 ─────────────────────────────────────────────────────────────
describe('Schema 常數', () => {
  test('THRESHOLDS 包含所有必要欄位', () => {
    const requiredKeys = ['TAIEX', 'SP500', 'NASDAQ', 'USDTWD', 'VIX', 'DXY', 'US10Y'];
    for (const key of requiredKeys) {
      assert.ok(THRESHOLDS[key], `缺少 ${key} 的門檻設定`);
      assert.ok(typeof THRESHOLDS[key].min === 'number', `${key}.min 必須是數字`);
      assert.ok(typeof THRESHOLDS[key].max === 'number', `${key}.max 必須是數字`);
      assert.ok(THRESHOLDS[key].min < THRESHOLDS[key].max, `${key}.min 必須小於 max`);
    }
  });

  test('DEGRADATION_LABELS 包含三個標記', () => {
    assert.equal(DEGRADATION_LABELS.DELAYED, '[DELAYED]');
    assert.equal(DEGRADATION_LABELS.UNVERIFIED, '[UNVERIFIED]');
    assert.equal(DEGRADATION_LABELS.NA, 'N/A');
  });

  test('IMPORTANCE_LEVELS 順序正確', () => {
    assert.deepEqual(IMPORTANCE_LEVELS, ['P0', 'P1', 'P2', 'P3']);
  });
});

// ─── validateMarketDataPoint 測試 ────────────────────────────────────────────
describe('validateMarketDataPoint', () => {
  test('TAIEX 正常值 22000 通過驗證', () => {
    const result = validate.marketDataPoint('TAIEX', {
      value: 22000, changePct: 0.85, source: 'twse', fetchedAt: new Date().toISOString()
    });
    assert.ok(result.valid, `驗證失敗：${result.errors.join(', ')}`);
    assert.equal(result.errors.length, 0);
  });

  test('TAIEX 低於最小值 5000 觸發告警', () => {
    const result = validate.marketDataPoint('TAIEX', {
      value: 5000, changePct: 0, source: 'twse', fetchedAt: new Date().toISOString()
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('超出合理範圍')));
  });

  test('SP500 超過最大值 20000 觸發告警', () => {
    const result = validate.marketDataPoint('SP500', {
      value: 20000, changePct: 0, source: 'fmp', fetchedAt: new Date().toISOString()
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('超出合理範圍')));
  });

  test('TAIEX 單日變幅 -15% 超過 ±10% 上限觸發警告', () => {
    const result = validate.marketDataPoint('TAIEX', {
      value: 18000, changePct: -15, source: 'twse', fetchedAt: new Date().toISOString()
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('單日變幅')));
  });

  test('USDTWD 正常值 31.5 通過驗證', () => {
    const result = validate.marketDataPoint('USDTWD', {
      value: 31.5, changePct: 0.1, source: 'twse', fetchedAt: new Date().toISOString()
    });
    assert.ok(result.valid);
  });

  test('USDTWD 超出範圍 40.0 觸發告警', () => {
    const result = validate.marketDataPoint('USDTWD', {
      value: 40.0, changePct: 0, source: 'yahoo', fetchedAt: new Date().toISOString()
    });
    assert.ok(!result.valid);
  });

  test('VIX 正常值 15.3 通過驗證', () => {
    const result = validate.marketDataPoint('VIX', {
      value: 15.3, changePct: 5, source: 'fmp', fetchedAt: new Date().toISOString()
    });
    assert.ok(result.valid);
  });

  test('NA 降級標記跳過驗證', () => {
    const result = validate.marketDataPoint('TAIEX', {
      value: 0, degraded: 'NA', source: 'none', fetchedAt: new Date().toISOString()
    });
    assert.ok(result.valid, '降級標記 NA 應跳過驗證');
  });

  test('未知欄位 FOOBAR 通過（無門檻設定）', () => {
    const result = validate.marketDataPoint('FOOBAR', { value: 999 });
    assert.ok(result.valid);
  });
});

// ─── crossCheck 測試 ──────────────────────────────────────────────────────────
describe('crossCheck', () => {
  test('兩來源差距 0.3%，容差 0.5% → 通過', () => {
    const result = validate.crossCheck(22000, 22066, 0.005);
    assert.ok(result);
  });

  test('兩來源差距 1%，容差 0.5% → 不通過', () => {
    const result = validate.crossCheck(22000, 22220, 0.005);
    assert.ok(!result);
  });

  test('其中一個值為 0 → 不通過', () => {
    const result = validate.crossCheck(0, 22000, 0.005);
    assert.ok(!result);
  });

  test('SP500 差距 0.2%，容差 0.3% → 通過', () => {
    const result = validate.crossCheck(5100, 5110.2, 0.003);
    assert.ok(result);
  });
});

// ─── validateDailyBriefData 測試 ─────────────────────────────────────────────
describe('validateDailyBriefData', () => {
  const validData = {
    date: '2026-02-18',
    generatedAt: '2026-02-18T08:00:00Z',
    marketData: {
      date: '2026-02-18',
      TAIEX: { value: 22458, changePct: 0.85, source: 'twse', fetchedAt: '2026-02-18T06:00:00Z' },
      SP500: { value: 5128, changePct: 0.65, source: 'fmp', fetchedAt: '2026-02-18T01:00:00Z' }
    },
    news: [],
    watchlist: []
  };

  test('有效 DailyBriefData 通過驗證', () => {
    const result = validate.dailyBriefData(validData);
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  test('缺少 date 欄位觸發錯誤', () => {
    const data = { ...validData, date: undefined };
    const result = validate.dailyBriefData(data);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('date')));
  });

  test('缺少 marketData 觸發錯誤', () => {
    const data = { ...validData, marketData: undefined };
    const result = validate.dailyBriefData(data);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('marketData')));
  });

  test('news 不是陣列觸發錯誤', () => {
    const data = { ...validData, news: 'not-array' };
    const result = validate.dailyBriefData(data);
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('news')));
  });

  test('null 輸入觸發錯誤', () => {
    const result = validate.dailyBriefData(null);
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
  });

  test('TAIEX 值異常觸發 warnings（不影響 valid）', () => {
    const data = {
      ...validData,
      marketData: {
        ...validData.marketData,
        TAIEX: { value: 5000, changePct: -20, source: 'twse', fetchedAt: '2026-02-18T06:00:00Z' }
      }
    };
    const result = validate.dailyBriefData(data);
    // valid=true（warnings 不阻止），但 warnings 非空
    assert.ok(result.warnings.length > 0);
  });
});

// ─── schemas 匯出測試 ─────────────────────────────────────────────────────────
describe('Schema 物件匯出', () => {
  test('所有 schema 物件存在', () => {
    const expectedSchemas = [
      'MarketDataPoint', 'MarketData', 'NewsItem', 'SecFiling',
      'WatchlistItem', 'EventItem', 'MarketRegime', 'AiAnalysis', 'DailyBriefData'
    ];
    for (const name of expectedSchemas) {
      assert.ok(schema.schemas[name], `缺少 schema: ${name}`);
      assert.equal(schema.schemas[name].type, 'object');
    }
  });
});

// ─── Rate Limiter 測試 ────────────────────────────────────────────────────────
describe('RateLimiter — intervalMs 模式（SEC EDGAR）', () => {
  const { RateLimiter } = require('../shared/rate-limiter');

  test('intervalMs: 100 → reqPerMin 計算正確（600）', () => {
    const rl = new RateLimiter();
    rl.register('secEdgar', { intervalMs: 100 });
    const status = rl.getStatus();
    assert.equal(status.secEdgar.reqPerMin, 600);
    assert.equal(status.secEdgar.refillIntervalMs, 100);
  });

  test('reqPerMin: 5 → refillIntervalMs 計算正確（12000）', () => {
    const rl = new RateLimiter();
    rl.register('perplexity', { reqPerMin: 5 });
    const status = rl.getStatus();
    assert.equal(status.perplexity.reqPerMin, 5);
    assert.equal(status.perplexity.refillIntervalMs, 12000);
  });

  test('init() 從 config 批次初始化', () => {
    const rl = new RateLimiter();
    rl.init({
      perplexity: { reqPerMin: 5 },
      fmp:        { reqPerMin: 10 },
      secEdgar:   { intervalMs: 100 }
    });
    const status = rl.getStatus();
    assert.ok(status.perplexity);
    assert.ok(status.fmp);
    assert.ok(status.secEdgar);
    assert.equal(status.secEdgar.refillIntervalMs, 100);
  });

  test('acquire() 快速取得令牌（bucket 未耗盡）', async () => {
    const rl = new RateLimiter();
    rl.register('fast-api', { reqPerMin: 600 });
    const start = Date.now();
    await rl.acquire('fast-api');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `取得令牌耗時 ${elapsed}ms，應 < 100ms`);
  });
});

// ─── CostLedger 測試 ─────────────────────────────────────────────────────────
describe('CostLedger — 成本計算', () => {
  const { CostLedger } = require('../shared/cost-ledger');

  test('recordLlmUsage 計算 haiku 成本', () => {
    const cl = new CostLedger();
    cl.startRun('phase3');
    cl.recordLlmUsage('haiku', { input_tokens: 1000, output_tokens: 500 });
    const cost = cl.calculateTotal();
    // 1000 * 0.00000025 + 500 * 0.00000125 = 0.00025 + 0.000625 = 0.000875
    assert.ok(Math.abs(cost - 0.000875) < 0.0000001, `haiku 成本計算錯誤：${cost}`);
  });

  test('recordLlmUsage 計算 sonnet 成本', () => {
    const cl = new CostLedger();
    cl.startRun('phase3');
    cl.recordLlmUsage('sonnet', { input_tokens: 2000, output_tokens: 1000 });
    const cost = cl.calculateTotal();
    // 2000 * 0.000003 + 1000 * 0.000015 = 0.006 + 0.015 = 0.021
    assert.ok(Math.abs(cost - 0.021) < 0.0000001, `sonnet 成本計算錯誤：${cost}`);
  });

  test('recordApiCall 追蹤 secEdgar 呼叫', () => {
    const cl = new CostLedger();
    cl.startRun('phase1');
    cl.recordApiCall('secEdgar', 5);
    assert.equal(cl.currentRun.apiCalls.secEdgar, 5);
  });

  test('checkBudget 初始狀態不超過預算', () => {
    const cl = new CostLedger();
    cl.init({ dailyBudgetUsd: 2.0 });
    cl.startRun('test');
    const check = cl.checkBudget();
    assert.ok(!check.overBudget);
    assert.equal(check.budget, 2.0);
  });

  test('perplexity 呼叫計入成本', () => {
    const cl = new CostLedger();
    cl.startRun('phase2');
    cl.recordApiCall('perplexity', 2);  // 2 * $0.005 = $0.01
    const cost = cl.calculateTotal();
    assert.ok(Math.abs(cost - 0.01) < 0.0001, `perplexity 成本計算錯誤：${cost}`);
  });

  test('startRun 帶 phase 標記', () => {
    const cl = new CostLedger();
    cl.startRun('phase4');
    assert.equal(cl.currentRun.phase, 'phase4');
  });
});
