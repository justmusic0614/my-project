/**
 * WeeklyPipeline — 週報 Pipeline
 * 週五 UTC 09:30 = 台北 17:30 執行
 *
 * 流程：
 *   1. 收集本週 5 天的 phase3-result（或從 daily-brief/ 存檔讀取）
 *   2. 彙整週度市場表現（各指數週漲跌）
 *   3. 提取本週 Top5 重要事件
 *   4. AI 生成下週展望（Sonnet）
 *   5. WeeklyRenderer 渲染
 *   6. Telegram 推播 + 存檔
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const { WeeklyRenderer } = require('../renderers/weekly-renderer');
const TelegramPublisher  = require('../publishers/telegram-publisher');
const ArchivePublisher   = require('../publishers/archive-publisher');
const AlertPublisher     = require('../publishers/alert-publisher');
const { AIAnalyzer }     = require('../processors/ai-analyzer');

const logger = createLogger('pipeline:weekly');

const DATA_DIR   = path.join(__dirname, '../data');
const DAILY_DIR  = path.join(DATA_DIR, 'daily-brief');
const WEEKLY_DIR = path.join(DATA_DIR, 'weekly-report');

class WeeklyPipeline {
  constructor(config = {}) {
    this.config = config;
  }

  async run() {
    logger.info('=== Weekly Pipeline starting ===');
    const startTime = Date.now();
    costLedger.startRun('weekly');

    const weekLabel  = this._currentWeekLabel();
    const dateRange  = this._currentWeekDateRange();

    // ── 1. 收集本週數據 ──────────────────────────────────────────────────────
    logger.info('[Step 1] Loading this week\'s daily briefs...');
    const weeklyData = this._aggregateWeeklyData();

    // ── 2. AI 生成下週展望 ───────────────────────────────────────────────────
    logger.info('[Step 2] Generating AI weekly outlook...');
    let aiOutlook = '';
    try {
      const analyzer = new AIAnalyzer(this.config.anthropic || {});
      aiOutlook = await this._generateOutlook(analyzer, weeklyData);
    } catch (err) {
      logger.warn(`AI outlook failed: ${err.message}`);
    }

    // ── 3. 渲染週報 ──────────────────────────────────────────────────────────
    logger.info('[Step 3] Rendering weekly report...');
    const renderer    = new WeeklyRenderer();
    const reportText  = renderer.render({
      weekLabel,
      dateRange,
      weeklyMarket:   weeklyData.weeklyMarket,
      topEvents:      weeklyData.topEvents,
      sectorPerf:     weeklyData.sectorPerf,
      twSummary:      weeklyData.twSummary,
      aiOutlook,
      nextWeekEvents: weeklyData.nextWeekEvents
    });

    // ── 4. 推播 ──────────────────────────────────────────────────────────────
    logger.info('[Step 4] Publishing weekly report...');
    const telegramConfig = this.config.telegram || {};
    const telegram = new TelegramPublisher({
      botToken:         telegramConfig.botToken,
      chatId:           telegramConfig.chatId,
      dryRun:           this.config.dryRun || false,
      maxMessageLength: telegramConfig.maxMessageLength || 4000
    });

    let telegramResult = { sent: 0, failed: 0 };
    try {
      telegramResult = await telegram.publishWeeklyReport(reportText);
    } catch (err) {
      logger.error(`weekly telegram publish failed: ${err.message}`);
      const alerter = new AlertPublisher(telegram, { cooldownMs: 0 });
      await alerter.pipelineFailed('weekly-telegram', err);
    }

    // ── 5. 存檔 ───────────────────────────────────────────────────────────────
    logger.info('[Step 5] Archiving weekly report...');
    const archiver = new ArchivePublisher({
      basePath:   DATA_DIR,
      dailyPath:  DAILY_DIR,
      weeklyPath: WEEKLY_DIR,
      gitEnabled: this.config.archive?.gitEnabled !== false
    });

    let archiveResult = {};
    try {
      archiveResult = archiver.archiveWeeklyReport(weekLabel, reportText, weeklyData);
      archiver.gitCommit(`market-digest: weekly report ${weekLabel}`);
    } catch (err) {
      logger.warn(`weekly archive failed: ${err.message}`);
    }

    const summary = costLedger.getDailySummary();
    const duration = Date.now() - startTime;

    logger.info('=== Weekly Pipeline complete ===', {
      weekLabel,
      duration:      `${Math.round(duration / 1000)}s`,
      telegram_sent: telegramResult.sent,
      cost:          `$${summary.totalCost?.toFixed(4) ?? '0.0000'}`
    });

    return {
      weekLabel,
      dateRange,
      status:   telegramResult.failed === 0 ? 'ok' : 'partial',
      duration,
      telegram: telegramResult,
      archive:  archiveResult,
      cost:     summary.totalCost
    };
  }

  /**
   * 聚合本週數據（從 daily-brief/ 讀取 5 天存檔）
   */
  _aggregateWeeklyData() {
    const weekDates = this._getWeekDates();
    const allMarket = {};
    const allNews   = [];
    const allEvents = [];
    const twStats   = { foreignWeekNet: 0, trustWeekNet: 0, weekVolume: 0 };

    for (const date of weekDates) {
      const jsonPath = path.join(DAILY_DIR, `${date}.json`);
      if (!fs.existsSync(jsonPath)) continue;

      try {
        const day = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const md  = day.marketData || {};

        // 累積週度漲跌（以最後一天的 close 為週收盤）
        for (const [key, val] of Object.entries(md)) {
          if (val?.value != null) {
            if (!allMarket[key]) allMarket[key] = { weekOpen: val.value };
            allMarket[key].weekClose    = val.value;
            allMarket[key].weekChangePct = val.changePct;
          }
        }

        // 彙整法人（週度累加）
        if (day.institutionalData) {
          twStats.foreignWeekNet += day.institutionalData.foreign || 0;
          twStats.trustWeekNet   += day.institutionalData.trust   || 0;
        }

        // 收集本週 AI 排序新聞
        const rankedNews = day.aiResult?.rankedNews || [];
        allNews.push(...rankedNews.filter(n => n.importance === 'P0' || n.importance === 'P1'));

        // 收集事件
        if (Array.isArray(day.events)) {
          allEvents.push(...day.events);
        }
      } catch (err) {
        logger.warn(`failed to load daily brief ${date}: ${err.message}`);
      }
    }

    // 計算週度漲跌（若有 weekOpen）
    const weeklyMarket = {};
    for (const [key, val] of Object.entries(allMarket)) {
      weeklyMarket[key] = {
        weekClose:    val.weekClose,
        weekChangePct: val.weekChangePct // 使用最後一天的日漲跌幅作為近似
      };
    }

    // Top5 重要事件（去重）
    const seen = new Set();
    const topEvents = allNews
      .filter(n => { if (seen.has(n.title)) return false; seen.add(n.title); return true; })
      .sort((a, b) => { const p = {P0:0,P1:1,P2:2,P3:3}; return p[a.importance]-p[b.importance]; })
      .slice(0, 5);

    // 下週行事曆（來自最近一天的 events，type=earnings/economic 且日期 > 今天）
    const today = _today();
    const nextWeekEvents = allEvents
      .filter(e => e.date > today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);

    return {
      weeklyMarket,
      topEvents,
      sectorPerf:     {},           // 可後續從 TWSE 板塊資料擴展
      twSummary:      twStats,
      nextWeekEvents
    };
  }

  /**
   * AI 生成下週展望
   */
  async _generateOutlook(analyzer, weeklyData) {
    if (!process.env.ANTHROPIC_API_KEY) return '';

    // 組合本週重要事件作為 context
    const eventSummary = weeklyData.topEvents
      .slice(0, 5)
      .map((n, i) => `${i+1}. [${n.importance}] ${n.title}${n.aiSummary ? `（${n.aiSummary}）` : ''}`)
      .join('\n');

    // 直接呼叫 AI analyzer 的 Sonnet stage
    const fakeNewsForContext = [{
      title: `下週展望生成 context：\n${eventSummary}`,
      importance: 'P0',
      summary: '本週市場回顧與下週展望'
    }];

    // 使用 analyze 方法，取 dailySnapshot 作為週展望
    const result = await analyzer.analyze(fakeNewsForContext, weeklyData.weeklyMarket || {});
    return result.skipped ? '' : (result.dailySnapshot || '');
  }

  _currentWeekLabel() {
    const now  = new Date();
    const year = now.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((now - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }

  _currentWeekDateRange() {
    const now     = new Date();
    const day     = now.getUTCDay(); // 0=Sun
    const monday  = new Date(now.getTime() - (day === 0 ? 6 : day - 1) * 86400000);
    const friday  = new Date(monday.getTime() + 4 * 86400000);
    const fmt     = (d) => d.toISOString().slice(0, 10).replace(/-/g, '/');
    return `${fmt(monday)} – ${fmt(friday)}`;
  }

  /**
   * 取得本週 5 個交易日的日期（週一到週五）
   */
  _getWeekDates() {
    const now    = new Date();
    const day    = now.getUTCDay();
    const monday = new Date(now.getTime() - (day === 0 ? 6 : day - 1) * 86400000);
    const dates  = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday.getTime() + i * 86400000);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = WeeklyPipeline;
