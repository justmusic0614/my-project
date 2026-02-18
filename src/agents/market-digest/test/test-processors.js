/**
 * test-processors.js — 處理器層單元測試
 * 測試範圍：validator / deduplicator / importance-scorer / ai-analyzer（stub）
 * 執行：node --test test/test-processors.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// ── 路徑設定 ────────────────────────────────────────────────────────────────
const BASE = `${__dirname}/..`;

// ══════════════════════════════════════════════════════════════════════════
// Validator 測試
// ══════════════════════════════════════════════════════════════════════════
describe('Validator', () => {
  const validator = require(`${BASE}/processors/validator`);

  // 輔助：建立合法的 MarketDataPoint
  const makePoint = (value, source = 'test', changePct = 0.5) => ({
    value, source, changePct,
    change: value * changePct / 100,
    fetchedAt: new Date().toISOString()
  });

  test('validate: basic market data assembly', () => {
    const collected = {
      twse:    { TAIEX: makePoint(22000, 'twse', 0.5) },
      fmp:     { SP500: makePoint(5100, 'fmp', 0.3), NASDAQ: makePoint(16000, 'fmp', 0.4) },
      finmind: { TAIEX: makePoint(22010, 'finmind', 0.5) },
      yahoo:   { SP500: makePoint(5102, 'yahoo', 0.3), USDTWD: makePoint(31.5, 'yahoo', 0.1) }
    };
    const { marketData, validationReport } = validator.validate(collected);
    assert.ok(marketData, 'marketData should exist');
    assert.ok(marketData.date, 'date should be set');
    assert.ok(validationReport, 'validationReport should exist');
    assert.ok(Array.isArray(validationReport.schemaErrors), 'schemaErrors should be array');
    assert.ok(Array.isArray(validationReport.crossCheckWarnings), 'crossCheckWarnings should be array');
  });

  test('validate: handles missing sources gracefully', () => {
    const collected = { twse: null, fmp: null, finmind: null, yahoo: null };
    const { marketData, validationReport } = validator.validate(collected);
    // 無數據 → TAIEX 應該是 NA
    assert.equal(marketData.TAIEX.degraded, 'NA');
    assert.equal(marketData.SP500.degraded, 'NA');
    assert.ok(validationReport.degradedFields.length > 0);
  });

  test('validate: cross-check warning when sources diverge', () => {
    const collected = {
      twse:    { TAIEX: makePoint(22000, 'twse', 0.5) },
      fmp:     null,
      finmind: { TAIEX: makePoint(21500, 'finmind', 0.5) }, // 差 500 點 > 0.5%
      yahoo:   null
    };
    const { validationReport } = validator.validate(collected);
    assert.ok(validationReport.crossCheckWarnings.length > 0, 'should have cross-check warning');
    assert.ok(validationReport.crossCheckWarnings[0].includes('TAIEX'), 'warning should mention TAIEX');
  });

  test('validate: cross-check passes within tolerance', () => {
    const collected = {
      twse:    { TAIEX: makePoint(22000, 'twse', 0.5) },
      fmp:     null,
      finmind: { TAIEX: makePoint(22005, 'finmind', 0.5) }, // 差 5 點 < 0.5%
      yahoo:   null
    };
    const { validationReport } = validator.validate(collected);
    assert.equal(validationReport.crossCheckWarnings.length, 0, 'should pass cross-check');
  });

  test('validateNews: filters invalid items', () => {
    const news = [
      { title: 'ok news', source: 'test' },
      { title: 'hi',      source: 'test' },  // 標題太短
      { title: 'another ok news', source: null } // 無 source
    ];
    const { valid, invalid } = validator.validateNews(news);
    assert.equal(valid.length, 1);
    assert.equal(invalid.length, 2);
  });

  test('validateSecFilings: filters invalid filings', () => {
    const filings = [
      { formType: '8-K', company: 'NVDA', filedAt: '2025-01-01' },
      { formType: null,  company: 'AMD',  filedAt: '2025-01-01' }, // 缺 formType
      { formType: '13F', company: null,   filedAt: '2025-01-01' }  // 缺 company
    ];
    const { valid, invalid } = validator.validateSecFilings(filings);
    assert.equal(valid.length, 1);
    assert.equal(invalid.length, 2);
  });

  test('validate: hasErrors is false when only warnings', () => {
    const collected = {
      twse: { TAIEX: makePoint(22000, 'twse', 0.5) },
      fmp:  { SP500: makePoint(5100,  'fmp',  0.3) },
      finmind: null,
      yahoo: null
    };
    const { hasErrors } = validator.validate(collected);
    assert.equal(hasErrors, false, 'warnings only should not set hasErrors');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Deduplicator 測試
// ══════════════════════════════════════════════════════════════════════════
describe('NewsDeduplicator', () => {
  const { NewsDeduplicator } = require(`${BASE}/processors/deduplicator`);
  const dedup = new NewsDeduplicator();

  const makeNews = (title, opts = {}) => ({
    id: `id-${Math.random()}`,
    title,
    summary:     opts.summary     || '',
    source:      opts.source      || 'test',
    url:         opts.url         || `https://example.com/${encodeURIComponent(title.slice(0, 10))}`,
    publishedAt: opts.publishedAt || new Date().toISOString(),
    importance:  opts.importance  || 'P3'
  });

  test('deduplicate: empty array returns empty', () => {
    const { unique, removed } = dedup.deduplicate([]);
    assert.equal(unique.length, 0);
    assert.equal(removed.length, 0);
  });

  test('deduplicate: exact URL duplicates removed', () => {
    const url = 'https://example.com/same-url';
    const items = [
      makeNews('Title A', { url, importance: 'P1' }),
      makeNews('Title B', { url, importance: 'P3' })  // same URL, lower priority
    ];
    const { unique } = dedup.deduplicate(items);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].title, 'Title A', 'should keep higher priority');
  });

  test('deduplicate: unique URLs all kept', () => {
    const items = [
      makeNews('Fed raises rates by 25bp', { url: 'https://a.com/1' }),
      makeNews('NVIDIA reports record earnings', { url: 'https://b.com/2' }),
      makeNews('Taiwan stock market rises', { url: 'https://c.com/3' })
    ];
    const { unique } = dedup.deduplicate(items);
    assert.equal(unique.length, 3);
  });

  test('deduplicate: near-duplicate titles removed by prefix', () => {
    const items = [
      makeNews('Fed raises interest rates to 5.5%, highest in 22 years',    { url: 'https://a.com/1' }),
      makeNews('Fed raises interest rates to 5.5%, market reacts sharply',  { url: 'https://a.com/2' })
    ];
    const { unique } = dedup.deduplicate(items);
    assert.equal(unique.length, 1, 'title prefix duplicates should be removed');
  });

  test('deduplicate: report contains pass statistics', () => {
    const items = [makeNews('Unique news A'), makeNews('Unique news B')];
    const { report } = dedup.deduplicate(items);
    assert.ok(report.total > 0);
    assert.ok(Array.isArray(report.passes));
    assert.equal(report.passes.length, 4, 'should have 4 passes');
  });

  test('deduplicate: preserves P0 over P2 duplicate', () => {
    const title = 'FOMC raises rates';
    const items = [
      makeNews(title, { url: 'https://a.com/1', importance: 'P2' }),
      makeNews(title, { url: 'https://a.com/1', importance: 'P0' })
    ];
    const { unique } = dedup.deduplicate(items);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].importance, 'P0');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ImportanceScorer 測試
// ══════════════════════════════════════════════════════════════════════════
describe('ImportanceScorer', () => {
  const { ImportanceScorer, KEYWORDS, GEOPOLITICS_TRIGGERS } = require(`${BASE}/processors/importance-scorer`);
  const scorer = new ImportanceScorer();

  const makeNews = (title, opts = {}) => ({
    title,
    summary:     opts.summary     || '',
    source:      opts.source      || 'test',
    publishedAt: new Date().toISOString(),
    importance:  opts.importance  || 'P3'
  });

  test('KEYWORDS exported correctly', () => {
    assert.ok(Array.isArray(KEYWORDS.P0), 'P0 keywords should be array');
    assert.ok(Array.isArray(KEYWORDS.P1), 'P1 keywords should be array');
    assert.ok(Array.isArray(KEYWORDS.P2), 'P2 keywords should be array');
    assert.ok(KEYWORDS.P0.includes('Fed'), 'P0 should include Fed');
    assert.ok(KEYWORDS.P1.includes('NVIDIA'), 'P1 should include NVIDIA');
  });

  test('GEOPOLITICS_TRIGGERS exported', () => {
    assert.ok(Array.isArray(GEOPOLITICS_TRIGGERS));
    assert.ok(GEOPOLITICS_TRIGGERS.length > 0);
  });

  test('score: Fed/FOMC news gets P0', () => {
    const items = [makeNews('Fed raises rates by 25bp at FOMC meeting')];
    const { scored } = scorer.score(items);
    assert.equal(scored[0].importance, 'P0');
    assert.ok(scored[0].rawScore >= 40, 'P0 should have score >= 40');
  });

  test('score: NVIDIA earnings gets P1', () => {
    const items = [makeNews('NVIDIA beats earnings estimate, raises guidance')];
    const { scored } = scorer.score(items);
    assert.equal(scored[0].importance, 'P1');
  });

  test('score: 外資買超 gets P2', () => {
    const items = [makeNews('外資今日買超台股 150 億元')];
    const { scored } = scorer.score(items);
    assert.equal(scored[0].importance, 'P2');
  });

  test('score: generic news gets P3', () => {
    const items = [makeNews('今日天氣晴朗，適合戶外活動')];
    const { scored } = scorer.score(items);
    assert.equal(scored[0].importance, 'P3');
  });

  test('score: sorted P0 before P3', () => {
    const items = [
      makeNews('今日天氣晴朗'),
      makeNews('Fed FOMC raises rates')
    ];
    const { scored } = scorer.score(items);
    assert.equal(scored[0].importance, 'P0', 'P0 should be first');
    assert.equal(scored[1].importance, 'P3', 'P3 should be last');
  });

  test('score: geopoliticsTrigger detected', () => {
    const items = [makeNews('Taiwan Strait tension rises as military exercises begin')];
    const { geopoliticsTrigger } = scorer.score(items);
    assert.equal(geopoliticsTrigger, true);
  });

  test('score: no geopoliticsTrigger for normal news', () => {
    const items = [makeNews('S&P 500 closes higher on tech gains')];
    const { geopoliticsTrigger } = scorer.score(items);
    assert.equal(geopoliticsTrigger, false);
  });

  test('score: empty array', () => {
    const { scored, geopoliticsTrigger } = scorer.score([]);
    assert.equal(scored.length, 0);
    assert.equal(geopoliticsTrigger, false);
  });

  test('selectForAI: returns forHaiku and forSonnet', () => {
    const items = Array.from({ length: 60 }, (_, i) => ({
      ...makeNews(`News item ${i + 1}`),
      importance: i < 5 ? 'P0' : i < 15 ? 'P1' : 'P3',
      rawScore: 60 - i
    }));
    const { forHaiku, forSonnet } = scorer.selectForAI(items, { maxForHaiku: 50, maxForSonnet: 15 });
    assert.ok(forHaiku.length <= 50, 'Haiku input should be capped at 50');
    assert.ok(forSonnet.length <= 15, 'Sonnet input should be capped at 15');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AIAnalyzer 測試（stub 模式，不發真實 API）
// ══════════════════════════════════════════════════════════════════════════
describe('AIAnalyzer (stub mode)', () => {
  // 確保環境變數未設定（測試時不應發 API）
  const savedKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = '';

  const { AIAnalyzer } = require(`${BASE}/processors/ai-analyzer`);

  test('analyze: returns skipped result when no API key', async () => {
    const analyzer = new AIAnalyzer();
    const result = await analyzer.analyze([{ title: 'test', importance: 'P1' }], {});
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no_api_key');
    assert.ok(Array.isArray(result.rankedNews));
    assert.ok(Array.isArray(result.keyInsights));
  });

  test('analyze: returns skipped result for empty news', async () => {
    const analyzer = new AIAnalyzer();
    const result = await analyzer.analyze([], {});
    assert.equal(result.skipped, true);
  });

  test('_buildMarketContext: formats market data', () => {
    const analyzer = new AIAnalyzer();
    const marketData = {
      TAIEX:  { value: 22000, changePct: 0.85 },
      SP500:  { value: 5100,  changePct: 0.30 },
      VIX:    { value: 15.3 },
      US10Y:  { value: 4.28 },
      USDTWD: { value: 31.05, changePct: -0.1 }
    };
    const ctx = analyzer._buildMarketContext(marketData);
    assert.ok(ctx.includes('22000'),  'should include TAIEX value');
    assert.ok(ctx.includes('5100'),   'should include SP500 value');
    assert.ok(ctx.includes('15.3'),   'should include VIX');
    assert.ok(ctx.includes('4.28'),   'should include US10Y');
  });

  test('_extractJson: parses plain JSON', () => {
    const analyzer = new AIAnalyzer();
    const json = '{"key": "value"}';
    const result = analyzer._extractJson(json);
    assert.equal(result, json);
  });

  test('_extractJson: parses JSON in code block', () => {
    const analyzer = new AIAnalyzer();
    const json = '{"key": "value"}';
    const result = analyzer._extractJson(`\`\`\`json\n${json}\n\`\`\``);
    assert.equal(result, json);
  });

  test('_extractJson: throws for non-JSON text', () => {
    const analyzer = new AIAnalyzer();
    assert.throws(() => analyzer._extractJson('this is plain text'), /no JSON found/);
  });

  // 還原環境變數
  process.env.ANTHROPIC_API_KEY = savedKey || '';
});

// ══════════════════════════════════════════════════════════════════════════
// 整合：Deduplicator + Scorer 串接
// ══════════════════════════════════════════════════════════════════════════
describe('Processor Pipeline Integration', () => {
  const { NewsDeduplicator } = require(`${BASE}/processors/deduplicator`);
  const { ImportanceScorer } = require(`${BASE}/processors/importance-scorer`);

  test('dedup then score: correct flow', () => {
    const dedup  = new NewsDeduplicator();
    const scorer = new ImportanceScorer();

    const items = [
      { title: 'Fed raises rates by 25bp', source: 'reuters', url: 'https://a.com/1', publishedAt: new Date().toISOString(), importance: 'P3' },
      { title: 'Fed raises rates by 25bp', source: 'cnbc',    url: 'https://a.com/1', publishedAt: new Date().toISOString(), importance: 'P3' }, // dup
      { title: 'NVIDIA beats earnings',    source: 'fmp',     url: 'https://b.com/2', publishedAt: new Date().toISOString(), importance: 'P3' }
    ];

    const { unique } = dedup.deduplicate(items);
    assert.equal(unique.length, 2, 'dedup should remove 1 duplicate');

    const { scored } = scorer.score(unique);
    assert.equal(scored[0].importance, 'P0', 'Fed news should be P0 after scoring');
    assert.equal(scored[1].importance, 'P1', 'NVIDIA news should be P1 after scoring');
  });
});
