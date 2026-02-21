#!/usr/bin/env node
// daily-cost-report.js - 每日全局成本日報
// 推播 kanban LLM + market-digest 全部費用到 Telegram
// Cron: 30 1 * * * UTC（台北 09:30）

const path = require('path');
const fs = require('fs');

// 載入 kanban .env（含 TELEGRAM_BOT_TOKEN + TELEGRAM_ALERT_CHAT_ID）
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { sendTelegramReply } = require('../server/lib/telegram-utils');
const apiUsageService = require('../server/services/api-usage-service');
const marketCostService = require('../server/services/market-cost-service');

// 報告日期：UTC 01:30 跑時對應台北昨日
const reportDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
const chatId = process.env.TELEGRAM_ALERT_CHAT_ID;

async function main() {
  console.log(`[daily-cost-report] 開始生成 ${reportDate} 成本日報`);

  if (!chatId) {
    console.error('[daily-cost-report] TELEGRAM_ALERT_CHAT_ID 未設定');
    process.exit(1);
  }

  // 取得 kanban LLM 費用（含 knowledge-digest 所有呼叫）
  const kanban = apiUsageService.getDayStats(reportDate);

  // 取得 market-digest 費用（LLM + FMP/Perplexity 等）
  const market = marketCostService.getDailyCost(reportDate);

  const totalUsd = (kanban.cost_usd || 0) + (market ? market.total_cost_usd : 0);
  const totalTwd = Math.round(totalUsd * 33 * 10) / 10;

  // 組成訊息（繁體中文）
  let msg = `💰 ${reportDate} 成本日報\n`;
  msg += `── 總計：$${totalUsd.toFixed(4)} USD（$${totalTwd} TWD）\n`;
  msg += `── Kanban LLM：${kanban.calls} 次呼叫，$${kanban.cost_usd.toFixed(4)} USD\n`;

  if (market) {
    msg += `── Market-Digest：$${market.total_cost_usd.toFixed(4)} USD`;
    const apiCalls = market.external_api_calls || {};
    const apiSummary = Object.entries(apiCalls)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k}:${v}次`)
      .join(' ');
    if (apiSummary) msg += `（外部API ${apiSummary}）`;
    msg += '\n';
  } else {
    msg += '── Market-Digest：今日無交易記錄\n';
  }

  console.log(`[daily-cost-report] ${msg.trim()}`);

  const ok = await sendTelegramReply(chatId, msg.trim());
  if (!ok) {
    console.error('[daily-cost-report] Telegram 推播失敗');
    process.exit(1);
  }

  console.log('[daily-cost-report] 推播成功');
}

main().catch(err => {
  console.error('[daily-cost-report] 意外錯誤:', err.message);
  process.exit(1);
});
