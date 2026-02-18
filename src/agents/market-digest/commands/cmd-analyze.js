/**
 * /analyze <代號> — 個股深度分析（AI 驅動）
 * 功能：
 *   1. 讀取 phase3 數據中的個股報價 + 外資籌碼
 *   2. 呼叫 Perplexity 取得最新個股新聞（可選）
 *   3. 呼叫 Claude Sonnet 生成深度分析報告
 *
 * 使用方式：
 *   /analyze 2330
 *   /analyze NVDA
 *   /a 2330
 */

'use strict';

const path = require('path');
const fs   = require('path');
const fsSync = require('fs');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const logger = createLogger('cmd:analyze');

const STATE_FILE = path.join(__dirname, '../data/pipeline-state/phase3-result.json');

// 成本限制（每次分析最多 $0.10）
const MAX_COST_PER_ANALYZE = 0.10;

async function handle(args, config = {}) {
  if (args.length === 0) {
    return '❌ 請指定股票代號\n💡 例如：/analyze 2330 或 /analyze NVDA';
  }

  const symbol  = args[0].toUpperCase();
  const options = _parseOptions(args.slice(1));

  logger.info(`/analyze ${symbol}`, options);

  // 預算檢查
  const budget = costLedger.checkBudget();
  if (budget.overBudget) {
    return `⚠️ 今日已達 AI 分析預算上限（$${budget.budget}），請明日再試`;
  }

  // 從 phase3 取得個股現有數據
  const stockData = _loadStockData(symbol);

  // 組合分析 prompt
  const analysisText = await _generateAnalysis(symbol, stockData, config);

  return analysisText;
}

/**
 * 從 phase3-result 提取個股數據
 */
function _loadStockData(symbol) {
  try {
    if (!fsSync.existsSync(STATE_FILE)) return null;
    const phase3 = JSON.parse(fsSync.readFileSync(STATE_FILE, 'utf8'));
    const prices = phase3.institutionalData?.tw50Prices || {};
    const price  = prices[symbol] || null;

    // 也找相關新聞
    const relatedNews = (phase3.uniqueNews || [])
      .filter(n => {
        const text = `${n.title} ${n.summary || ''}`;
        return text.includes(symbol);
      })
      .slice(0, 5);

    return { price, relatedNews, date: phase3.date };
  } catch {
    return null;
  }
}

/**
 * 呼叫 Claude Sonnet 生成個股分析
 */
async function _generateAnalysis(symbol, stockData, config) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 降級：只顯示數據，不生成 AI 分析
    return _formatDataOnly(symbol, stockData);
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey });

    const context = _buildContext(symbol, stockData);
    const prompt  = `你是專業股票分析師，請針對 ${symbol} 提供簡潔的投資分析報告。

${context}

請以以下格式回覆（繁體中文，每點不超過 25 字）：

📊 ${symbol} 個股分析

價格動態：
• [今日表現與技術面簡述]

籌碼分析：
• [外資/投信動向]

產業展望：
• [所屬產業趨勢 1-2 點]

風險提示：
• [主要風險因素]

💡 操作建議：[短期 1-2 句]

---
⚠️ 本分析僅供參考，不構成投資建議`;

    const message = await client.messages.create({
      model:      config.anthropic?.stage2Model || 'claude-sonnet-4-5-20250929',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }]
    });

    costLedger.recordLlmUsage('sonnet', message.usage);

    return message.content[0].text;

  } catch (err) {
    logger.warn(`AI analysis failed for ${symbol}: ${err.message}`);
    return _formatDataOnly(symbol, stockData);
  }
}

/**
 * 無 API Key 或 AI 失敗時的純數據回覆
 */
function _formatDataOnly(symbol, stockData) {
  if (!stockData?.price) {
    return [
      `📊 ${symbol}`,
      '',
      '⚠️ 無報價數據（可能不在 FinMind watchlist 中）',
      `💡 請先執行 /watchlist add ${symbol} 加入追蹤`
    ].join('\n');
  }

  const p     = stockData.price;
  const arrow = (p.changePct ?? 0) >= 0 ? '▲' : '▼';
  const sign  = (p.changePct ?? 0) >= 0 ? '+' : '';

  const lines = [
    `📊 ${symbol} ${stockData.date || ''}`,
    '',
    `收盤：${p.close} ${arrow}${sign}${(p.changePct || 0).toFixed(2)}%`,
    `今日：開 ${p.open} 高 ${p.high} 低 ${p.low}`,
    `量：${p.volume?.toLocaleString() || 'N/A'} 張`
  ];

  if (p.foreignNet != null) {
    const lots   = Math.abs(Math.round(p.foreignNet / 1000));
    const action = p.foreignNet >= 0 ? '外資買超' : '外資賣超';
    lines.push(`${action}：${lots.toLocaleString()} 張`);
  }

  if (stockData.relatedNews?.length > 0) {
    lines.push('', '📰 相關新聞：');
    stockData.relatedNews.slice(0, 3).forEach(n => lines.push(`  • ${n.title}`));
  }

  lines.push('', '⚠️ AI 分析暫時不可用（ANTHROPIC_API_KEY 未設定）');
  return lines.join('\n');
}

function _buildContext(symbol, stockData) {
  if (!stockData) return `股票代號：${symbol}（無當日數據）`;

  const parts = [`股票代號：${symbol}`];
  if (stockData.date) parts.push(`日期：${stockData.date}`);

  if (stockData.price) {
    const p = stockData.price;
    parts.push(`收盤：${p.close}，漲跌：${(p.changePct || 0).toFixed(2)}%`);
    if (p.volume) parts.push(`成交量：${p.volume.toLocaleString()} 張`);
    if (p.foreignNet != null) {
      const lots   = Math.abs(Math.round(p.foreignNet / 1000));
      const action = p.foreignNet >= 0 ? '買超' : '賣超';
      parts.push(`外資：${action} ${lots} 張`);
    }
  }

  if (stockData.relatedNews?.length > 0) {
    parts.push('相關新聞：');
    stockData.relatedNews.slice(0, 3).forEach(n => parts.push(`- ${n.title}`));
  }

  return parts.join('\n');
}

function _parseOptions(args) {
  return {
    days: parseInt(args.find((a, i) => args[i - 1] === '--days') || '1', 10) || 1
  };
}

module.exports = { handle };
