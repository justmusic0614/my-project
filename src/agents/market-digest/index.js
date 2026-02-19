#!/usr/bin/env node
/**
 * Market Digest Agent v2.0 — 統一入口
 *
 * CLI 用法：
 *   node index.js pipeline              # 完整 4-phase 日報
 *   node index.js pipeline --phase 1   # 只跑 phase1
 *   node index.js pipeline --dry-run   # 不發 Telegram，只本地渲染
 *   node index.js pipeline --weekend   # 週末日報（快取+Perplexity）
 *   node index.js weekly               # 週報 pipeline
 *   node index.js cost --today         # 今日成本報告
 *   node index.js preview              # 預覽最新日報
 *
 * 環境變數：
 *   ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   FMP_API_KEY, FINMIND_API_TOKEN, PERPLEXITY_API_KEY
 *   SEC_EDGAR_USER_AGENT（格式：Name Email）
 */

'use strict';

// 集中式 .env 載入：優先 ~/clawd/.env（VPS），fallback 本地 .env
const path = require('path');
const fs = require('fs');
const centralEnv = path.join(process.env.HOME || '', 'clawd', '.env');
const localEnv = path.join(__dirname, '.env');
require('dotenv').config({ path: fs.existsSync(centralEnv) ? centralEnv : localEnv });

const { getConfig } = require('./shared/config-loader');
const costLedger    = require('./shared/cost-ledger');
const { createLogger } = require('./shared/logger');

const logger = createLogger('index');

// ── CLI 解析 ──────────────────────────────────────────────────────────────
const [,, command, ...args] = process.argv;
const flags = {
  phase:      _getFlag(args, '--phase'),     // '1' | '2' | '3' | '4'
  dryRun:     args.includes('--dry-run'),
  weekend:    args.includes('--weekend'),
  today:      args.includes('--today'),
  preview:    args.includes('--preview'),
  year:       _getFlag(args, '--year'),      // sync-holidays: '2027'
  nextYear:   args.includes('--next-year')   // sync-holidays: 同步次年
};

// ── 主函式 ────────────────────────────────────────────────────────────────
async function main() {
  // 載入配置
  const config = getConfig().toJSON();
  costLedger.init(config.costLedger || {});

  // 注入 dry-run 和 paths
  config.dryRun = flags.dryRun;

  logger.info(`Market Digest Agent v${config.version || '2.0.0'} starting`);
  logger.info(`command=${command}, phase=${flags.phase || 'all'}, dryRun=${flags.dryRun}`);

  switch (command) {

    // ── pipeline ──────────────────────────────────────────────────────────
    case 'pipeline': {
      const Orchestrator = require('./pipeline/orchestrator');
      const orchestrator = new Orchestrator(config);

      let mode = 'daily';
      if (flags.phase)   mode = `phase${flags.phase}`;
      if (flags.weekend) mode = 'weekend';

      const result = await orchestrator.run(mode);
      _printResult(result);
      break;
    }

    // ── weekly ────────────────────────────────────────────────────────────
    case 'weekly': {
      const WeeklyPipeline = require('./pipeline/weekly-pipeline');
      const pipeline = new WeeklyPipeline(config);
      const result = await pipeline.run();
      _printResult(result);
      break;
    }

    // ── cost ──────────────────────────────────────────────────────────────
    case 'cost': {
      const formatter = require('./renderers/telegram-formatter');
      const summary   = costLedger.getDailySummary();
      console.log(formatter.formatCostReport(summary));
      break;
    }

    // ── preview ───────────────────────────────────────────────────────────
    case 'preview': {
      const path = require('path');
      const fs   = require('fs');
      const statePath = path.join(__dirname, 'data/pipeline-state/phase3-result.json');
      if (!fs.existsSync(statePath)) {
        console.error('phase3-result.json not found. Run pipeline first.');
        process.exit(1);
      }
      const phase3 = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const { DailyRenderer } = require('./renderers/daily-renderer');
      const renderer = new DailyRenderer();
      const watchlist = _loadWatchlist(config.paths?.watchlist);
      const text = renderer.render({
        date:             phase3.date,
        marketData:       phase3.marketData || {},
        aiResult:         phase3.aiResult   || {},
        rankedNews:       phase3.aiResult?.rankedNews || phase3.uniqueNews || [],
        watchlist,
        events:           phase3.events     || [],
        secFilings:       phase3.secFilings || [],
        institutionalData: phase3.institutionalData || {},
        gainersLosers:    phase3.gainersLosers || {}
      });
      console.log(text);
      break;
    }

    // ── sync-holidays ─────────────────────────────────────────────────────
    case 'sync-holidays': {
      const HolidaySync = require('./etl/holiday-sync');
      const sync = new HolidaySync(config);

      const year = flags.year ? parseInt(flags.year) : new Date().getFullYear();
      const dryRun = flags.dryRun || !config.calendarSync?.autoUpdate;

      logger.info(`sync-holidays: year=${year}, dryRun=${dryRun}, nextYear=${flags.nextYear}`);

      if (flags.nextYear) {
        // 同步當年 + 次年
        await sync.syncCurrentAndNext({ dryRun });
      } else {
        // 同步指定年份
        await sync.syncYear(year, { dryRun });
      }
      break;
    }

    // ── 未知命令 ───────────────────────────────────────────────────────────
    default:
      _printUsage();
      process.exit(1);
  }
}

// ── 輔助函式 ──────────────────────────────────────────────────────────────
function _getFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

function _printResult(result) {
  const status = result.status || (result.phases ? 'done' : 'ok');
  const cost   = result.cost?.totalCost ?? result.cost;
  const costStr = (cost != null && !isNaN(cost)) ? Number(cost).toFixed(4) : 'N/A';
  console.log(`[done] status=${status} cost=$${costStr}`);
}

function _loadWatchlist(watchlistPath) {
  const path = require('path');
  const fs   = require('fs');
  const p    = watchlistPath || path.join(__dirname, 'data/watchlist.json');
  try {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(data) ? data : (data.watchlist || []);
    }
  } catch {}
  return [];
}

function _printUsage() {
  console.log(`
Market Digest Agent v2.0

Usage:
  node index.js pipeline              完整 4-phase 日報
  node index.js pipeline --phase N    只跑第 N 個 phase（1-4）
  node index.js pipeline --dry-run    不發 Telegram，只本地渲染
  node index.js pipeline --weekend    週末日報
  node index.js weekly                週報 pipeline
  node index.js cost --today          今日成本報告
  node index.js preview               預覽最新日報
  node index.js sync-holidays         同步當年休市日（TWSE）
  node index.js sync-holidays --year 2027     同步指定年份
  node index.js sync-holidays --next-year     同步當年 + 次年
  node index.js sync-holidays --dry-run       Dry-run 模式（產生 .new 檔案）

環境變數：
  ANTHROPIC_API_KEY    Claude API 金鑰
  TELEGRAM_BOT_TOKEN   Telegram Bot Token
  TELEGRAM_CHAT_ID     推播頻道/群組 ID
  FMP_API_KEY          Financial Modeling Prep API 金鑰
  FINMIND_API_TOKEN    FinMind API Token（台股）
  PERPLEXITY_API_KEY   Perplexity API 金鑰
  SEC_EDGAR_USER_AGENT SEC EDGAR User-Agent（格式：Name email@example.com）
`);
}

// ── 執行 ──────────────────────────────────────────────────────────────────
main().catch(err => {
  logger.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
