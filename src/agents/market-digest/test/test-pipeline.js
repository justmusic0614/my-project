/**
 * test-pipeline.js — Pipeline 整合測試（無網路依賴）
 * 測試範圍：orchestrator / phase 模組 / index.js 結構 / weekly-pipeline
 * 執行：node --test test/test-pipeline.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

const BASE = `${__dirname}/..`;

// ══════════════════════════════════════════════════════════════════════════
// Orchestrator 測試
// ══════════════════════════════════════════════════════════════════════════
describe('Orchestrator', () => {
  const Orchestrator = require(`${BASE}/pipeline/orchestrator`);

  test('constructor: creates instance', () => {
    const orc = new Orchestrator({ dryRun: true });
    assert.ok(orc instanceof Orchestrator);
  });

  test('_withTimeout: resolves before timeout', async () => {
    const orc = new Orchestrator({});
    const result = await orc._withTimeout(
      Promise.resolve('ok'),
      5000,
      'should not timeout'
    );
    assert.equal(result, 'ok');
  });

  test('_withTimeout: rejects on timeout', async () => {
    const orc = new Orchestrator({});
    const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow'), 10000));
    await assert.rejects(
      () => orc._withTimeout(slowPromise, 50, 'test timeout'),
      /test timeout/
    );
  });

  test('run: rejects on unknown mode', async () => {
    const orc = new Orchestrator({ dryRun: true });
    await assert.rejects(
      () => orc.run('invalid-mode'),
      /Unknown mode/
    );
  });

  test('_sleep: resolves after delay', async () => {
    const orc  = new Orchestrator({});
    const start = Date.now();
    await orc._sleep(50);
    assert.ok(Date.now() - start >= 40, 'should sleep at least 40ms');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase Module 結構測試（不執行實際 API）
// ══════════════════════════════════════════════════════════════════════════
describe('Phase Module Exports', () => {
  test('phase1: exports runPhase1 and OUTPUT_FILE', () => {
    const { runPhase1, OUTPUT_FILE } = require(`${BASE}/pipeline/phase1-us-collect`);
    assert.ok(typeof runPhase1 === 'function');
    assert.ok(OUTPUT_FILE.includes('phase1-result.json'));
  });

  test('phase2: exports runPhase2 and OUTPUT_FILE', () => {
    const { runPhase2, OUTPUT_FILE } = require(`${BASE}/pipeline/phase2-tw-collect`);
    assert.ok(typeof runPhase2 === 'function');
    assert.ok(OUTPUT_FILE.includes('phase2-result.json'));
  });

  test('phase3: exports runPhase3 and OUTPUT_FILE', () => {
    const { runPhase3, OUTPUT_FILE } = require(`${BASE}/pipeline/phase3-process`);
    assert.ok(typeof runPhase3 === 'function');
    assert.ok(OUTPUT_FILE.includes('phase3-result.json'));
  });

  test('phase4: exports runPhase4 and INPUT_FILE', () => {
    const { runPhase4, INPUT_FILE } = require(`${BASE}/pipeline/phase4-assemble`);
    assert.ok(typeof runPhase4 === 'function');
    assert.ok(INPUT_FILE.includes('phase3-result.json'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WeeklyPipeline 測試
// ══════════════════════════════════════════════════════════════════════════
describe('WeeklyPipeline', () => {
  const WeeklyPipeline = require(`${BASE}/pipeline/weekly-pipeline`);

  test('constructor: creates instance', () => {
    const wp = new WeeklyPipeline({ dryRun: true });
    assert.ok(wp instanceof WeeklyPipeline);
  });

  test('_currentWeekLabel: returns YYYY-WXX format', () => {
    const wp = new WeeklyPipeline({});
    const label = wp._currentWeekLabel();
    assert.match(label, /^\d{4}-W\d{2}$/);
  });

  test('_currentWeekDateRange: returns date range string', () => {
    const wp = new WeeklyPipeline({});
    const range = wp._currentWeekDateRange();
    assert.ok(range.includes('–'), 'should contain date range separator');
    assert.match(range, /\d{4}\/\d{2}\/\d{2} – \d{4}\/\d{2}\/\d{2}/);
  });

  test('_getWeekDates: returns 5 dates', () => {
    const wp    = new WeeklyPipeline({});
    const dates = wp._getWeekDates();
    assert.equal(dates.length, 5, 'should return 5 week dates');
    dates.forEach(d => assert.match(d, /^\d{4}-\d{2}-\d{2}$/));
  });

  test('_aggregateWeeklyData: handles missing daily briefs gracefully', () => {
    const wp = new WeeklyPipeline({});
    // 當沒有 daily-brief/ 存檔時，應返回空物件不拋錯
    const data = wp._aggregateWeeklyData();
    assert.ok(data, 'should return data object');
    assert.ok(typeof data.weeklyMarket === 'object');
    assert.ok(Array.isArray(data.topEvents));
    assert.ok(Array.isArray(data.nextWeekEvents));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 3 資料提取函數測試（透過模擬輸入）
// ══════════════════════════════════════════════════════════════════════════
describe('Phase 3 Helpers (via module internals)', () => {
  // 直接測試 phase3 的模擬流程（使用真實的 validators 等）
  test('phase3 module loads without errors', () => {
    assert.doesNotThrow(() => {
      require(`${BASE}/pipeline/phase3-process`);
    });
  });

  test('phase4 module loads without errors', () => {
    assert.doesNotThrow(() => {
      require(`${BASE}/pipeline/phase4-assemble`);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// index.js 結構測試（不執行主程序）
// ══════════════════════════════════════════════════════════════════════════
describe('Index.js Structure', () => {
  test('index.js file exists', () => {
    const indexPath = path.join(BASE, 'index.js');
    assert.ok(fs.existsSync(indexPath), 'index.js should exist');
  });

  test('index.js contains main pipeline commands', () => {
    const indexPath = path.join(BASE, 'index.js');
    const content   = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('pipeline'),  'should handle pipeline command');
    assert.ok(content.includes('weekly'),    'should handle weekly command');
    assert.ok(content.includes('cost'),      'should handle cost command');
    assert.ok(content.includes('preview'),   'should handle preview command');
    assert.ok(content.includes('dry-run'),   'should support --dry-run flag');
    assert.ok(content.includes('Orchestrator'), 'should use Orchestrator');
  });

  test('index.js contains environment variable documentation', () => {
    const indexPath = path.join(BASE, 'index.js');
    const content   = fs.readFileSync(indexPath, 'utf8');
    assert.ok(content.includes('ANTHROPIC_API_KEY'));
    assert.ok(content.includes('TELEGRAM_BOT_TOKEN'));
    assert.ok(content.includes('FMP_API_KEY'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Pipeline State 檔案路徑一致性測試
// ══════════════════════════════════════════════════════════════════════════
describe('Pipeline State Path Consistency', () => {
  test('phase1 output = phase2 input expectation', () => {
    const { OUTPUT_FILE: p1Out } = require(`${BASE}/pipeline/phase1-us-collect`);
    // phase2 讀取 phase1-result.json
    const p2Content = fs.readFileSync(`${BASE}/pipeline/phase2-tw-collect.js`, 'utf8');
    assert.ok(p2Content.includes('phase1-result.json'), 'phase2 should reference phase1-result.json');
  });

  test('phase2 output = phase3 input', () => {
    const { OUTPUT_FILE: p2Out } = require(`${BASE}/pipeline/phase2-tw-collect`);
    const p3Content = fs.readFileSync(`${BASE}/pipeline/phase3-process.js`, 'utf8');
    assert.ok(p3Content.includes('phase2-result.json'), 'phase3 should reference phase2-result.json');
  });

  test('phase3 output = phase4 input', () => {
    const { OUTPUT_FILE: p3Out } = require(`${BASE}/pipeline/phase3-process`);
    const { INPUT_FILE: p4In }   = require(`${BASE}/pipeline/phase4-assemble`);
    assert.ok(p4In.includes('phase3-result.json'));
    assert.ok(p3Out.includes('phase3-result.json'));
  });

  test('all phase files are in pipeline/ directory', () => {
    const pipelineDir = path.join(BASE, 'pipeline');
    const files = fs.readdirSync(pipelineDir);
    const expected = [
      'orchestrator.js',
      'phase1-us-collect.js',
      'phase2-tw-collect.js',
      'phase3-process.js',
      'phase4-assemble.js',
      'weekly-pipeline.js'
    ];
    for (const f of expected) {
      assert.ok(files.includes(f), `${f} should exist in pipeline/`);
    }
  });
});
