/**
 * test-renderers.js — 渲染層 + 推播層單元測試
 * 測試範圍：daily-renderer / weekly-renderer / telegram-formatter / archive-publisher / alert-publisher
 * 執行：node --test test/test-renderers.js
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const BASE = `${__dirname}/..`;

// ══════════════════════════════════════════════════════════════════════════
// DailyRenderer 測試
// ══════════════════════════════════════════════════════════════════════════
describe('DailyRenderer', () => {
  const { DailyRenderer } = require(`${BASE}/renderers/daily-renderer`);
  const renderer = new DailyRenderer();

  const makeDataPoint = (value, changePct = 0.5, opts = {}) => ({
    value, changePct,
    change:    value * changePct / 100,
    source:    'test',
    fetchedAt: new Date().toISOString(),
    ...opts
  });

  const sampleBrief = {
    date: '2026-02-18',
    marketData: {
      TAIEX:  makeDataPoint(22000, 0.85),
      SP500:  makeDataPoint(5100, 0.30),
      NASDAQ: makeDataPoint(16200, 0.45),
      DJI:    makeDataPoint(38500, 0.20),
      USDTWD: makeDataPoint(31.05, -0.15),
      VIX:    makeDataPoint(15.3, -2.0),
      US10Y:  makeDataPoint(4.28, 0.01),
      DXY:    makeDataPoint(104.5, 0.10),
      GOLD:   makeDataPoint(2650, 0.30),
      OIL_WTI: makeDataPoint(72.5, -0.50),
      BTC:    makeDataPoint(95000, 2.0),
      taiexVolume: 3.25e11
    },
    aiResult: {
      dailySnapshot:   '台股收漲 0.85%，受 AI 族群帶動。Fed 維持利率不變，市場情緒偏多。外資連續買超台積電',
      marketRegime:    'Risk-on',
      structuralTheme: 'AI 基礎設施建設',
      keyInsights: ['台積電 CoWoS 擴產帶動供應鏈', 'VIX 下降至 15 代表恐慌情緒消散']
    },
    rankedNews: [
      { title: 'NVIDIA 財報大幅超預期', importance: 'P1', aiSummary: 'EPS 超預期 30%', source: 'fmp', publishedAt: new Date().toISOString() },
      { title: 'Fed 維持利率不變，暗示年底降息', importance: 'P0', aiSummary: 'FOMC 聲明偏鴿', source: 'reuters', publishedAt: new Date().toISOString() }
    ],
    watchlist: [
      { symbol: '2330', name: '台積電', price: 1050, changePct: 1.20 },
      { symbol: '0050', name: 'ETF50', price: 185, changePct: 0.54 }
    ],
    events: [
      { type: 'earnings',  date: '2026-02-19', company: 'NVIDIA',   symbol: 'NVDA' },
      { type: 'economic',  date: '2026-02-20', name: '美國 CPI 數據' }
    ],
    institutionalData: {
      foreign: 5000000000,
      trust:    800000000,
      dealer:  -200000000
    }
  };

  test('render: returns non-empty string', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(typeof result === 'string', 'should return string');
    assert.ok(result.length > 100, 'should have meaningful content');
  });

  test('render: contains header with date', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Daily Market Brief'), 'should include header');
    assert.ok(result.includes('2026-02-18'), 'should include date');
  });

  test('render: contains market data section', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('TAIEX'), 'should include TAIEX');
    assert.ok(result.includes('22,000') || result.includes('22000'), 'should include TAIEX value');
    assert.ok(result.includes('S&P 500'), 'should include SP500');
  });

  test('render: contains Daily Snapshot from AI', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Daily_Snapshot'), 'should include snapshot section');
    assert.ok(result.includes('台股收漲'), 'should include AI snapshot content');
  });

  test('render: contains market regime', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Market_Regime'), 'should include regime section');
    assert.ok(result.includes('Risk-on'), 'should show Risk-on regime');
    assert.ok(result.includes('🟢'), 'should show green circle for risk-on');
  });

  test('render: contains cross asset section', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Cross_Asset'), 'should include cross asset section');
    assert.ok(result.includes('黃金'), 'should include gold');
    assert.ok(result.includes('BTC'), 'should include bitcoin');
  });

  test('render: contains Taiwan market section', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Taiwan_Market'), 'should include TW section');
    assert.ok(result.includes('三大法人'), 'should include institutional');
    assert.ok(result.includes('外資'), 'should include foreign investors');
  });

  test('render: contains watchlist', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Watchlist_Focus'), 'should include watchlist section');
    assert.ok(result.includes('台積電') || result.includes('2330'), 'should include TSMC');
  });

  test('render: contains event calendar', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('Event_Calendar'), 'should include event section');
    assert.ok(result.includes('NVIDIA'), 'should include earnings event');
  });

  test('render: contains disclaimer', () => {
    const result = renderer.render(sampleBrief);
    assert.ok(result.includes('免責聲明'), 'should include disclaimer');
  });

  test('render: degraded label for UNVERIFIED data', () => {
    const briefWithDegraded = {
      ...sampleBrief,
      marketData: {
        ...sampleBrief.marketData,
        TAIEX: makeDataPoint(22000, 0.85, { degraded: 'UNVERIFIED' })
      }
    };
    const result = renderer.render(briefWithDegraded);
    assert.ok(result.includes('[UNVERIFIED]'), 'should show UNVERIFIED label');
  });

  test('render: no data points produces minimal output', () => {
    const result = renderer.render({ date: '2026-02-18', marketData: {}, aiResult: {}, rankedNews: [] });
    assert.ok(result.includes('Daily Market Brief'), 'should still have header');
    assert.ok(result.includes('免責聲明'), 'should still have disclaimer');
  });

  test('render: Equity_Market 顯示台股 Winners/Losers', () => {
    const brief = {
      ...sampleBrief,
      gainersLosers: {
        twGainers: [
          { symbol: '2330', name: '台積電', changePct: 3.26, source: 'finmind' },
          { symbol: '2454', name: '聯發科', changePct: 2.88, source: 'finmind' }
        ],
        twLosers: [
          { symbol: '2603', name: '長榮', changePct: -2.15, source: 'finmind' }
        ],
        usGainers: [],
        usLosers: []
      }
    };
    const result = renderer.render(brief);
    assert.ok(result.includes('Equity_Market'), 'should have equity section');
    assert.ok(result.includes('台積電'), 'should show TW gainers');
    assert.ok(result.includes('長榮'), 'should show TW losers');
    assert.ok(result.includes('[需升級 FMP 方案]'), 'should show US degradation hint');
  });

  test('render: Taiwan_Market 顯示 FinMind 融資融券（絕對值+變化）', () => {
    const brief = {
      ...sampleBrief,
      institutionalData: {
        ...sampleBrief.institutionalData,
        marginTotal: {
          marginBalance: 82340000,
          marginChange: -220000,
          shortBalance: 54321,
          shortChange: 121,
          source: 'finmind'
        }
      }
    };
    const result = renderer.render(brief);
    assert.ok(result.includes('融資餘額'), 'should include margin label');
    assert.ok(result.includes('融券餘額'), 'should include short label');
    assert.ok(result.includes('億'), 'should show 億 unit');
  });

  test('_fmtChg: positive change shows UP arrow', () => {
    const result = renderer._fmtChg(1.5);
    assert.ok(result.includes('▲'), 'should show up arrow');
    assert.ok(result.includes('+1.50%'), 'should show positive pct');
  });

  test('_fmtChg: negative change shows DOWN arrow', () => {
    const result = renderer._fmtChg(-0.8);
    assert.ok(result.includes('▼'), 'should show down arrow');
  });

  test('_fmtChg: null returns empty string', () => {
    assert.equal(renderer._fmtChg(null), '');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WeeklyRenderer 測試
// ══════════════════════════════════════════════════════════════════════════
describe('WeeklyRenderer', () => {
  const { WeeklyRenderer } = require(`${BASE}/renderers/weekly-renderer`);
  const renderer = new WeeklyRenderer();

  const sampleWeekly = {
    weekLabel: '2026-W08',
    dateRange: '2026/02/17 – 2026/02/21',
    weeklyMarket: {
      TAIEX:  { weekChangePct: 1.5, weekClose: 22000 },
      SP500:  { weekChangePct: 0.8, weekClose: 5100 },
      NASDAQ: { weekChangePct: 1.2, weekClose: 16200 }
    },
    topEvents: [
      { title: 'Fed 維持利率不變', importance: 'P0', aiSummary: 'FOMC 聲明偏鴿' },
      { title: 'NVIDIA 財報超預期', importance: 'P1', aiSummary: 'EPS +30%' }
    ],
    twSummary: {
      weekVolume:    3.5e12,
      foreignWeekNet: 1.5e10,
      topSectors: ['半導體', 'AI 族群']
    },
    aiOutlook: '下週 CPI 數據為市場焦點。若通膨繼續降溫，有利科技股。台積電法說會值得關注',
    nextWeekEvents: [
      { date: '2026-02-25', name: '美國 CPI 數據' },
      { date: '2026-02-26', name: '台積電法說會', company: 'TSMC' }
    ]
  };

  test('render: returns non-empty string', () => {
    const result = renderer.render(sampleWeekly);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 100);
  });

  test('render: contains weekly header with week label', () => {
    const result = renderer.render(sampleWeekly);
    assert.ok(result.includes('Weekly Market Report'));
    assert.ok(result.includes('2026-W08'));
  });

  test('render: contains market performance', () => {
    const result = renderer.render(sampleWeekly);
    assert.ok(result.includes('TAIEX'));
    assert.ok(result.includes('+1.50%') || result.includes('1.50%'));
  });

  test('render: contains top events', () => {
    const result = renderer.render(sampleWeekly);
    assert.ok(result.includes('關鍵事件'));
    assert.ok(result.includes('Fed'));
    assert.ok(result.includes('[重大]'), 'P0 event should have badge');
  });

  test('render: contains AI outlook', () => {
    const result = renderer.render(sampleWeekly);
    assert.ok(result.includes('下週展望'));
    assert.ok(result.includes('CPI'));
  });

  test('render: contains next week events', () => {
    const result = renderer.render(sampleWeekly);
    assert.ok(result.includes('行事曆'));
    assert.ok(result.includes('2026-02-25'));
  });

  test('render: empty data returns minimal output', () => {
    const result = renderer.render({});
    assert.ok(result.includes('Weekly Market Report'));
    assert.ok(result.includes('免責聲明'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TelegramFormatter 測試
// ══════════════════════════════════════════════════════════════════════════
describe('TelegramFormatter', () => {
  const { TelegramFormatter } = require(`${BASE}/renderers/telegram-formatter`);
  const fmt = new TelegramFormatter();

  test('splitReport: short text returns single element', () => {
    const result = fmt.splitReport('短文字', { maxLen: 4000 });
    assert.equal(result.length, 1);
    assert.equal(result[0], '短文字');
  });

  test('splitReport: long text split into multiple parts', () => {
    const longText = Array(20).fill('這是一段測試文字\n\n').join('');
    const result = fmt.splitReport(longText, { maxLen: 100 });
    assert.ok(result.length > 1, 'should produce multiple parts');
  });

  test('splitReport: parts get page labels when > 1', () => {
    const longText = Array(50).fill('測試段落文字\n\n').join('');
    const result = fmt.splitReport(longText, { maxLen: 100 });
    if (result.length > 1) {
      assert.ok(result[0].includes('[1/'), 'first part should have page label');
    }
  });

  test('splitReport: empty text returns empty array', () => {
    const result = fmt.splitReport('');
    assert.equal(result.length, 0);
  });

  test('formatAlert: contains title and timestamp', () => {
    const result = fmt.formatAlert('測試告警', '告警內容', 'ERROR');
    assert.ok(result.includes('🚨'), 'ERROR should have 🚨');
    assert.ok(result.includes('測試告警'));
    assert.ok(result.includes('告警內容'));
  });

  test('formatAlert: WARNING emoji', () => {
    const result = fmt.formatAlert('警告', '內容', 'WARNING');
    assert.ok(result.includes('⚠️'));
  });

  test('formatAlert: INFO emoji', () => {
    const result = fmt.formatAlert('資訊', '內容', 'INFO');
    assert.ok(result.includes('ℹ️'));
  });

  test('formatDegradedAlert: includes phase and error', () => {
    const result = fmt.formatDegradedAlert('phase1', { error: 'connection failed', degraded: ['TAIEX', 'SP500'] });
    assert.ok(result.includes('Phase: phase1'));
    assert.ok(result.includes('connection failed'));
    assert.ok(result.includes('TAIEX'));
  });

  test('formatCostReport: includes cost and budget', () => {
    const result = fmt.formatCostReport({ totalCost: 0.085, budget: 2, apiCalls: { fmp: 5, twse: 3 } });
    assert.ok(result.includes('$0.0850'));
    assert.ok(result.includes('$2'));
    assert.ok(result.includes('fmp: 5'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ArchivePublisher 測試
// ══════════════════════════════════════════════════════════════════════════
describe('ArchivePublisher', () => {
  const ArchivePublisher = require(`${BASE}/publishers/archive-publisher`);

  // 使用暫存目錄
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-digest-test-'));
  const archive = new ArchivePublisher({
    basePath:   tmpDir,
    dailyPath:  path.join(tmpDir, 'daily-brief'),
    weeklyPath: path.join(tmpDir, 'weekly-report'),
    gitEnabled: false
  });

  test('archiveDailyBrief: creates JSON and TXT files', () => {
    const date = '2026-02-18';
    const { jsonPath, txtPath } = archive.archiveDailyBrief(date, '測試日報文字', { marketData: { TAIEX: { value: 22000 } } });
    assert.ok(fs.existsSync(jsonPath), 'JSON file should exist');
    assert.ok(fs.existsSync(txtPath),  'TXT file should exist');
    assert.equal(fs.readFileSync(txtPath, 'utf8'), '測試日報文字');
  });

  test('archiveDailyBrief: JSON contains expected fields', () => {
    const date = '2026-02-19';
    const { jsonPath } = archive.archiveDailyBrief(date, '報告', { marketData: {} });
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(json.date, date);
    assert.ok(json.generatedAt, 'should have generatedAt');
  });

  test('archiveDailyBrief: updates index.json', () => {
    const indexPath = path.join(tmpDir, 'daily-brief', 'index.json');
    assert.ok(fs.existsSync(indexPath), 'index.json should be created');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.ok(index['2026-02-18'] || index['2026-02-19'], 'index should contain archived date');
  });

  test('archiveWeeklyReport: creates files', () => {
    const { jsonPath, txtPath } = archive.archiveWeeklyReport('2026-W08', '週報文字', {});
    assert.ok(fs.existsSync(jsonPath));
    assert.ok(fs.existsSync(txtPath));
    assert.equal(fs.readFileSync(txtPath, 'utf8'), '週報文字');
  });

  test('gitCommit: returns false when disabled', () => {
    const result = archive.gitCommit('test commit');
    assert.equal(result, false, 'should return false when git disabled');
  });

  // 清理暫存目錄
  test('cleanup', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    assert.ok(!fs.existsSync(tmpDir), 'tmp dir should be cleaned up');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AlertPublisher 測試（stub Telegram）
// ══════════════════════════════════════════════════════════════════════════
describe('AlertPublisher', () => {
  const AlertPublisher = require(`${BASE}/publishers/alert-publisher`);

  // Stub TelegramPublisher
  let publishedAlerts = [];
  const stubTelegram = {
    publishAlert: async (text) => { publishedAlerts.push(text); }
  };

  test('pipelineFailed: sends alert', async () => {
    publishedAlerts = [];
    const alerter = new AlertPublisher(stubTelegram, { cooldownMs: 0 });
    await alerter.pipelineFailed('phase1', new Error('test error'));
    assert.equal(publishedAlerts.length, 1);
    assert.ok(publishedAlerts[0].includes('phase1'));
    assert.ok(publishedAlerts[0].includes('test error'));
  });

  test('degradationAlert: skips if below threshold', async () => {
    publishedAlerts = [];
    const alerter = new AlertPublisher(stubTelegram, { cooldownMs: 0 });
    await alerter.degradationAlert(['TAIEX', 'SP500'], 5); // only 2 < 5
    assert.equal(publishedAlerts.length, 0, 'should not send if below threshold');
  });

  test('degradationAlert: sends if above threshold', async () => {
    publishedAlerts = [];
    const alerter = new AlertPublisher(stubTelegram, { cooldownMs: 0 });
    const fields = ['TAIEX', 'SP500', 'NASDAQ', 'DJI', 'USDTWD', 'VIX'];
    await alerter.degradationAlert(fields, 5);
    assert.equal(publishedAlerts.length, 1);
    assert.ok(publishedAlerts[0].includes('降級'));
  });

  test('cooldown: same alert not sent twice within cooldown', async () => {
    publishedAlerts = [];
    const alerter = new AlertPublisher(stubTelegram, { cooldownMs: 60000 }); // 1分鐘冷卻
    await alerter.criticalNoData('2026-02-18');
    await alerter.criticalNoData('2026-02-18'); // same key, should be blocked
    assert.equal(publishedAlerts.length, 1, 'second send should be blocked by cooldown');
  });

  test('budgetAlert: sends warning when over 80%', async () => {
    publishedAlerts = [];
    const alerter = new AlertPublisher(stubTelegram, { cooldownMs: 0 });
    await alerter.budgetAlert({ totalCost: 1.7, budget: 2 }); // 85%
    assert.equal(publishedAlerts.length, 1);
    assert.ok(publishedAlerts[0].includes('$1.7000'));
  });

  test('pipelineSuccess: sends info alert', async () => {
    publishedAlerts = [];
    const alerter = new AlertPublisher(stubTelegram, { cooldownMs: 0 });
    await alerter.pipelineSuccess({ date: '2026-02-18', duration: 45000, cost: 0.082, degraded: 2 });
    assert.equal(publishedAlerts.length, 1);
    assert.ok(publishedAlerts[0].includes('✅'));
  });

  test('no telegram: logs but does not throw', async () => {
    const alerter = new AlertPublisher(null, { cooldownMs: 0 });
    const result = await alerter.criticalNoData('2026-02-18');
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no_telegram');
  });
});
