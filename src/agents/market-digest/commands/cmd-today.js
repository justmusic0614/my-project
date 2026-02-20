/**
 * /today — 完整今日市場日報
 * 功能：讀取最新 phase3-result.json → 渲染完整 Daily Brief
 * 若無數據，提示用戶 pipeline 狀態
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { DailyRenderer }  = require('../renderers/daily-renderer');
const { createLogger }   = require('../shared/logger');
const { loadWatchlist }  = require('../shared/watchlist-loader');
const { analyzeRiskOff } = require('../analyzers/risk-off-analyzer');

// Fix G: 外資買賣超換算為 risk-off-analyzer 期望的「百萬元」單位
// TWSE API row[4] 解析後可能為「元」單位；除以 1e6 = 百萬元
// 台股休市時 val = undefined → 返回 0（不貢獻外資分數，正確行為）
function _toForeignMillions(val) {
  if (!val) return 0;
  return val / 1e6;
}

const logger = createLogger('cmd:today');

const STATE_FILE   = path.join(__dirname, '../data/pipeline-state/phase3-result.json');
const WATCHLIST_FILE = path.join(__dirname, '../data/watchlist.json');

const renderer = new DailyRenderer();

/**
 * @param {string[]} args   - 額外參數（未用）
 * @param {object}   config - 完整 config
 * @returns {Promise<string>}
 */
async function handle(args, config = {}, context = {}) {
  logger.info('/today executing');

  if (!fs.existsSync(STATE_FILE)) {
    return [
      '📊 今日日報尚未生成',
      '',
      '⏰ 日報排程：',
      '  • 05:30 美股收集',
      '  • 07:30 台股收集',
      '  • 07:45 AI 分析',
      '  • 08:00 日報推播',
      '',
      '💡 若已過 08:00 仍無日報，請聯繫管理員'
    ].join('\n');
  }

  try {
    const phase3  = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const watchlist = context.skipWatchlist ? [] : loadWatchlist(WATCHLIST_FILE);

    // Fix F: 日報標題日期使用推播當下的台北時間（UTC+8）
    const taipeiDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

    // Fix G: 計算量化 Risk-off Score（台股休市時外資 = 0，僅計算 VIX + 黃金等美股指標）
    const riskOff = analyzeRiskOff({
      vix:        phase3.marketData?.VIX?.value              || 15,
      gold:       { change: phase3.marketData?.GOLD?.changePct        || 0 },
      usd_jpy:    { change: 0 },   // phase3 無 USD/JPY，設為 0
      treasury:   { yield_10y_change: phase3.marketData?.US10Y?.changePct || 0 },
      foreign:    { netBuy: _toForeignMillions(phase3.institutionalData?.foreign) },
      stockIndex: { change: phase3.marketData?.TAIEX?.changePct       || 0 },
      volatility: { daily: Math.abs(phase3.marketData?.TAIEX?.changePct || 0) }
    }, phase3.uniqueNews || []);

    const briefText = renderer.render({
      date:              taipeiDate,                        // Fix F: 台北時間今日日期
      marketContext:     phase3.marketContext     || {},    // Fix E: 傳遞台股休市資訊
      marketData:        phase3.marketData        || {},
      riskOff,                                             // Fix G: 量化 Risk-off Score
      aiResult:          phase3.aiResult          || {},
      rankedNews:        phase3.aiResult?.rankedNews || phase3.uniqueNews || [],
      watchlist,
      events:            phase3.events            || [],
      secFilings:        phase3.secFilings         || [],
      institutionalData: phase3.institutionalData  || {},
      gainersLosers:     phase3.gainersLosers      || {}
    });

    const ts = new Date(phase3.processedAt || phase3.date).toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei', hour12: false
    });
    logger.info(`/today rendered: ${briefText.length} chars (data from ${ts})`);
    return briefText;
  } catch (err) {
    logger.error(`/today failed: ${err.message}`);
    return `❌ 日報讀取失敗：${err.message}`;
  }
}


module.exports = { handle };
