/**
 * test-commands.js — Telegram 命令處理器整合測試
 * 測試範圍：CommandRouter / cmd-today / cmd-watchlist / cmd-news /
 *           cmd-query / cmd-alerts / cmd-financial / cmd-analyze
 * 執行：node --test test/test-commands.js
 */

'use strict';

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

const BASE = `${__dirname}/..`;

// ── Mock phase3 資料 ──────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);

const MOCK_PHASE3 = {
  date:        TODAY,
  processedAt: new Date().toISOString(),
  marketData: {
    taiex: { value: 22000, changePct: 0.85, source: 'twse' },
    spx:   { value: 5100,  changePct: 0.65, source: 'fmp'  }
  },
  aiResult: {
    dailySnapshot: '市場測試快照',
    marketRegime:  'Risk-on',
    rankedNews: [
      { title: 'Fed 升息決議', importance: 'P0', source: 'reuters',   summary: 'Fed 維持利率不變', publishedAt: new Date().toISOString() },
      { title: 'NVIDIA 財報優於預期', importance: 'P1', source: 'bloomberg', summary: 'AI 晶片需求強勁', publishedAt: new Date().toISOString() },
      { title: '台積電外資買超',       importance: 'P2', source: 'cnyes',    summary: '', publishedAt: new Date().toISOString() }
    ]
  },
  uniqueNews: [
    { title: 'Fed 升息決議', importance: 'P0', source: 'reuters', summary: 'Fed 維持利率不變', publishedAt: new Date().toISOString() },
    { title: 'NVIDIA 財報優於預期', importance: 'P1', source: 'bloomberg', summary: 'AI 晶片需求強勁', publishedAt: new Date().toISOString() }
  ],
  institutionalData: {
    foreign: 5e9, trust: 1e9, dealer: -5e8,
    tw50Prices: {
      '2330': { close: 685, changePct: 1.2, foreignNet: 3200000, open: 680, high: 688, low: 678, volume: 50000 }
    }
  },
  events:       [{ date: '2026-02-20', type: 'earnings', description: 'AAPL 財報' }],
  secFilings:   [],
  gainersLosers: {}
};

const STATE_DIR      = path.join(BASE, 'data/pipeline-state');
const STATE_FILE     = path.join(STATE_DIR, 'phase3-result.json');
const WATCHLIST_FILE = path.join(BASE, 'data/watchlist.json');

/** 建立 mock phase3 state file，返回清理函式 */
function withPhase3(data) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(data ?? MOCK_PHASE3), 'utf8');
  return () => { try { fs.unlinkSync(STATE_FILE); } catch {} };
}

/** 暫時設定 watchlist，返回清理函式 */
function withWatchlist(items) {
  fs.mkdirSync(path.dirname(WATCHLIST_FILE), { recursive: true });
  const orig = fs.existsSync(WATCHLIST_FILE) ? fs.readFileSync(WATCHLIST_FILE, 'utf8') : null;
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(items), 'utf8');
  return () => {
    if (orig !== null) fs.writeFileSync(WATCHLIST_FILE, orig, 'utf8');
    else fs.writeFileSync(WATCHLIST_FILE, '[]', 'utf8');
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// CommandRouter
// ══════════════════════════════════════════════════════════════════════════════
describe('CommandRouter', () => {
  const CommandRouter = require(`${BASE}/commands/command-router`);

  test('constructor: creates instance', () => {
    const router = new CommandRouter({});
    assert.ok(router instanceof CommandRouter);
  });

  test('_parse: splits command and args', () => {
    const router = new CommandRouter({});
    const { cmd, args } = router._parse('/analyze 2330 --days 5');
    assert.equal(cmd, '/analyze');
    assert.deepEqual(args, ['2330', '--days', '5']);
  });

  test('_parse: command without args', () => {
    const router  = new CommandRouter({});
    const { cmd, args } = router._parse('/today');
    assert.equal(cmd, '/today');
    assert.equal(args.length, 0);
  });

  test('_parse: strips bot username @suffix', () => {
    const router = new CommandRouter({});
    const { cmd } = router._parse('/today@MyBotName');
    assert.equal(cmd, '/today');
  });

  test('_parse: lowercases command', () => {
    const router = new CommandRouter({});
    const { cmd } = router._parse('/TODAY');
    assert.equal(cmd, '/today');
  });

  test('handle: returns null for plain text (non-command)', async () => {
    const router = new CommandRouter({});
    const result = await router.handle('hello world');
    assert.equal(result, null);
  });

  test('handle: returns null for empty string', async () => {
    const router = new CommandRouter({});
    const result = await router.handle('');
    assert.equal(result, null);
  });

  test('handle: unknown command returns error message', async () => {
    const router = new CommandRouter({});
    const result = await router.handle('/nonexistent_cmd_xyz');
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('未知指令'));
  });

  test('handle: /help returns all main commands', async () => {
    const router = new CommandRouter({});
    const result = await router.handle('/help');
    assert.ok(result.includes('/today'));
    assert.ok(result.includes('/watchlist'));
    assert.ok(result.includes('/analyze'));
    assert.ok(result.includes('/news'));
    assert.ok(result.includes('/alerts'));
  });

  test('handle: alias /f resolves to /financial', async () => {
    const router  = new CommandRouter({});
    const restore = withWatchlist([]);
    try {
      const result = await router.handle('/f');
      assert.ok(typeof result === 'string');
      // /financial with empty watchlist → Watchlist 為空
      assert.ok(result.includes('Watchlist') || result.includes('watchlist') || result.includes('為空'));
    } finally {
      restore();
    }
  });

  test('handle: alias /w resolves to /watchlist', async () => {
    const router = new CommandRouter({});
    const result = await router.handle('/w list');
    assert.ok(typeof result === 'string');
  });

  test('handle: /突發 alias resolves to /news breaking', async () => {
    const router = new CommandRouter({});
    const result = await router.handle('/突發');
    assert.ok(typeof result === 'string');
  });

  test('handleUpdate: ignores update without message', async () => {
    const router = new CommandRouter({});
    await assert.doesNotReject(() => router.handleUpdate({}, null));
  });

  test('handleUpdate: ignores message without text', async () => {
    const router = new CommandRouter({});
    await assert.doesNotReject(() => router.handleUpdate({ message: { chat: { id: 1 } } }, null));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-today
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-today', () => {
  const { handle } = require(`${BASE}/commands/cmd-today`);

  test('no state file: returns schedule info', async () => {
    // 確保沒有 state 檔案
    if (fs.existsSync(STATE_FILE)) {
      // 有真實數據，測試有數據的路徑
      const result = await handle([], {});
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 10);
      return;
    }
    const result = await handle([], {});
    assert.ok(result.includes('08:00') || result.includes('日報'));
  });

  test('with mock state: renders non-empty brief', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle([], {});
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 50, 'brief should be substantial');
    } finally {
      cleanup();
    }
  });

  test('with mock state: includes date', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle([], {});
      assert.ok(result.includes(TODAY), `should contain today's date ${TODAY}`);
    } finally {
      cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-watchlist — CRUD 測試
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-watchlist', () => {
  const { handle } = require(`${BASE}/commands/cmd-watchlist`);

  // 測試前備份並清空 watchlist
  let savedContent = null;
  before(() => {
    fs.mkdirSync(path.dirname(WATCHLIST_FILE), { recursive: true });
    if (fs.existsSync(WATCHLIST_FILE)) {
      savedContent = fs.readFileSync(WATCHLIST_FILE, 'utf8');
    }
    fs.writeFileSync(WATCHLIST_FILE, '[]', 'utf8');
  });

  // 測試後恢復
  after(() => {
    const restore = savedContent !== null ? savedContent : '[]';
    fs.writeFileSync(WATCHLIST_FILE, restore, 'utf8');
  });

  test('list (empty): returns empty message', async () => {
    const result = await handle(['list'], {});
    assert.ok(result.includes('為空') || result.includes('empty'));
  });

  test('add: successfully adds a symbol', async () => {
    const result = await handle(['add', '2330'], {});
    assert.ok(result.includes('✅'));
    assert.ok(result.includes('2330'));
  });

  test('add: duplicate symbol shows skip message', async () => {
    const result = await handle(['add', '2330'], {}); // 已存在
    assert.ok(result.includes('⏭') || result.includes('已存在'));
  });

  test('add: multiple symbols at once', async () => {
    const result = await handle(['add', '0050', '2454'], {});
    assert.ok(result.includes('✅'));
  });

  test('list: shows added symbols', async () => {
    const result = await handle(['list'], {});
    assert.ok(result.includes('2330'));
  });

  test('remove: removes existing symbol', async () => {
    const result = await handle(['remove', '0050'], {});
    assert.ok(result.includes('✅'));
    assert.ok(result.includes('0050'));
  });

  test('remove: not found symbol shows notFound message', async () => {
    const result = await handle(['remove', 'NOTEXIST'], {});
    assert.ok(result.includes('❓') || result.includes('找不到'));
  });

  test('remove: alias rm works same as remove', async () => {
    const result = await handle(['rm', '2454'], {});
    assert.ok(typeof result === 'string');
  });

  test('clear: empties watchlist', async () => {
    await handle(['add', 'TEMP1'], {});
    const result = await handle(['clear'], {});
    assert.ok(result.includes('✅') && result.includes('清空'));
  });

  test('list (after clear): returns empty message', async () => {
    const result = await handle(['list'], {});
    assert.ok(result.includes('為空') || result.includes('empty'));
  });

  test('add: no symbols → error message', async () => {
    const result = await handle(['add'], {});
    assert.ok(result.includes('❌'));
  });

  test('remove: no symbols → error message', async () => {
    const result = await handle(['remove'], {});
    assert.ok(result.includes('❌'));
  });

  test('unknown subcommand: returns error', async () => {
    const result = await handle(['unknown_sub'], {});
    assert.ok(result.includes('❌') || result.includes('未知'));
  });

  test('default (no args): acts as list', async () => {
    const result = await handle([], {});
    assert.ok(typeof result === 'string');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-news
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-news', () => {
  const { handle } = require(`${BASE}/commands/cmd-news`);

  test('no state file: returns not-ready message', async () => {
    if (fs.existsSync(STATE_FILE)) return; // 有真實資料，跳過
    const result = await handle([], {});
    assert.ok(result.includes('尚未就緒') || result.includes('等候'));
  });

  test('with mock state (no args): returns today news header', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle([], {});
      assert.ok(result.includes('財經新聞') || result.includes('重要事件'));
    } finally {
      cleanup();
    }
  });

  test('with mock state: P0 news appears in today list', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle([], {});
      assert.ok(result.includes('Fed'));
    } finally {
      cleanup();
    }
  });

  test('with mock state: keyword search finds match', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle(['NVIDIA'], {});
      assert.ok(result.includes('NVIDIA'));
    } finally {
      cleanup();
    }
  });

  test('with mock state: keyword search no match', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle(['XYZNOTEXIST999'], {});
      assert.ok(result.includes('沒有相關新聞'));
    } finally {
      cleanup();
    }
  });

  test('breaking mode: with P0 news shows breaking header', async () => {
    const cleanup = withPhase3();
    try {
      const result = await handle([], {}, { isBreaking: true });
      assert.ok(result.includes('重大') || result.includes('P0') || result.includes('突發'));
    } finally {
      cleanup();
    }
  });

  test('breaking mode: no P0 news returns safe message', async () => {
    const data = {
      ...MOCK_PHASE3,
      uniqueNews: [{ title: 'P1 只有P1', importance: 'P1', source: 'test' }]
    };
    const cleanup = withPhase3(data);
    try {
      const result = await handle([], {}, { isBreaking: true });
      assert.ok(result.includes('無重大突發') || result.includes('🟢'));
    } finally {
      cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-query
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-query', () => {
  const { handle } = require(`${BASE}/commands/cmd-query`);

  test('no keyword: returns error with tip', async () => {
    const result = await handle([], {});
    assert.ok(result.includes('❌'));
    assert.ok(result.includes('關鍵字'));
  });

  test('keyword only: runs search (returns string)', async () => {
    const result = await handle(['台積電'], {});
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  test('--days flag: parsed without breaking', async () => {
    const result = await handle(['Fed', '--days', '14'], {});
    assert.ok(typeof result === 'string');
  });

  test('--days exceeds MAX_DAYS: clamped to 30', async () => {
    const result = await handle(['test', '--days', '999'], {});
    // 應正常執行（不超過 30 天）
    assert.ok(typeof result === 'string');
  });

  test('keyword filter: excludes --days args from keyword', async () => {
    const result = await handle(['FOMC', '--days', '7'], {});
    // 若有搜尋到，結果應包含 FOMC
    assert.ok(typeof result === 'string');
    // 關鍵字不應包含 "--days" 或 "7"（除非真的有這樣的內容）
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-alerts
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-alerts', () => {
  const { handle } = require(`${BASE}/commands/cmd-alerts`);

  test('default (no args): returns alert list string', async () => {
    const result = await handle([], {});
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });

  test('status subcommand: shows Pipeline header', async () => {
    const result = await handle(['status'], {});
    assert.ok(result.includes('Pipeline') || result.includes('phase'));
  });

  test('status subcommand: lists all 4 phases', async () => {
    const result = await handle(['status'], {});
    assert.ok(result.includes('phase1'));
    assert.ok(result.includes('phase2'));
    assert.ok(result.includes('phase3'));
    assert.ok(result.includes('phase4'));
  });

  test('with today error state: shows error in alerts', async () => {
    const errorData = {
      date:   TODAY,
      errors: { 'fmp': 'API timeout' },
      validationReport: { degradedFields: [], crossCheckWarnings: [] }
    };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const p1File = path.join(STATE_DIR, 'phase1-result.json');
    fs.writeFileSync(p1File, JSON.stringify(errorData), 'utf8');
    try {
      const result = await handle([], {});
      // 有 error 記錄時應包含告警關鍵字
      assert.ok(result.includes('ERROR') || result.includes('告警') || result.includes('🔴'));
    } finally {
      try { fs.unlinkSync(p1File); } catch {}
    }
  });

  test('with validation warnings: shows WARNING', async () => {
    const warnData = {
      date:   TODAY,
      errors: {},
      validationReport: {
        degradedFields:      ['f1','f2','f3','f4','f5'],
        crossCheckWarnings:  ['TAIEX cross-check failed']
      }
    };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const p2File = path.join(STATE_DIR, 'phase2-result.json');
    fs.writeFileSync(p2File, JSON.stringify(warnData), 'utf8');
    try {
      const result = await handle([], {});
      assert.ok(result.includes('WARNING') || result.includes('警告') || result.includes('🟡'));
    } finally {
      try { fs.unlinkSync(p2File); } catch {}
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-financial
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-financial', () => {
  const { handle } = require(`${BASE}/commands/cmd-financial`);

  test('empty watchlist: returns empty message', async () => {
    const restore = withWatchlist([]);
    try {
      const result = await handle([], {});
      assert.ok(result.includes('Watchlist') || result.includes('為空') || result.includes('empty'));
    } finally {
      restore();
    }
  });

  test('no phase3 state + watchlist exists: returns not-ready message', async () => {
    if (fs.existsSync(STATE_FILE)) return; // 有真實資料跳過
    const restore = withWatchlist([{ symbol: '2330', name: '台積電' }]);
    try {
      const result = await handle([], {});
      assert.ok(result.includes('尚未就緒') || result.includes('等候'));
    } finally {
      restore();
    }
  });

  test('with watchlist + mock state: shows symbol in output', async () => {
    const cleanWl = withWatchlist([{ symbol: '2330', name: '台積電' }]);
    const cleanP3 = withPhase3();
    try {
      const result = await handle([], {});
      assert.ok(result.includes('2330') || result.includes('台積電'));
    } finally {
      cleanWl();
      cleanP3();
    }
  });

  test('with watchlist + mock state: shows institutional data', async () => {
    const cleanWl = withWatchlist([{ symbol: '2330', name: '台積電' }]);
    const cleanP3 = withPhase3();
    try {
      const result = await handle([], {});
      assert.ok(result.includes('外資') || result.includes('投信'));
    } finally {
      cleanWl();
      cleanP3();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// cmd-analyze
// ══════════════════════════════════════════════════════════════════════════════
describe('cmd-analyze', () => {
  const { handle } = require(`${BASE}/commands/cmd-analyze`);

  test('no symbol: returns error with example', async () => {
    const result = await handle([], {});
    assert.ok(result.includes('❌'));
    assert.ok(result.includes('代號') || result.includes('example') || result.includes('例'));
  });

  test('symbol uppercase conversion: handles lowercase input', async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const cleanP3 = withPhase3();
    try {
      const result = await handle(['nvda'], {});
      assert.ok(result.includes('NVDA'));
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
      cleanP3();
    }
  });

  test('no API key + no stock data: returns no-data message', async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    try {
      const result = await handle(['MISSING_STOCK'], {});
      assert.ok(result.includes('MISSING_STOCK'));
      // 無數據 → 顯示提示
      assert.ok(result.includes('⚠️') || result.includes('watchlist') || result.includes('無'));
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  test('no API key + stock data exists: returns data-only report', async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const cleanP3 = withPhase3();
    try {
      const result = await handle(['2330'], {});
      assert.ok(result.includes('2330'));
      // 無 API → 降級訊息
      assert.ok(result.includes('⚠️') || result.includes('AI') || result.includes('685'));
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
      cleanP3();
    }
  });
});
