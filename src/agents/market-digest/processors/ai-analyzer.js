/**
 * AIAnalyzer — Two-Stage Claude API 分析器
 * Phase 3 核心：新聞 AI 分析 + Daily Snapshot 生成
 *
 * Two-Stage 流程：
 *   Stage 1 (Haiku 4.5)：P0-P3 重新分級篩選（低成本，處理 ~50 則新聞）
 *   Stage 2 (Sonnet 4.5)：Top 10-15 深度分析 + Daily Snapshot 生成
 *
 * 輸出：
 *   - rankedNews: 按重要性排序的新聞（帶 AI 摘要）
 *   - dailySnapshot: 2-3 句 Daily Brief 開頭摘要
 *   - marketRegime: Risk-on / Risk-off / Neutral
 *   - structuralTheme: 當代熱門主題識別
 *   - skipped: true 如果跳過（無 API Key / 超預算）
 *
 * 成本估算：
 *   Stage 1 (Haiku): ~$0.003/次（50則新聞 ~2000 tokens）
 *   Stage 2 (Sonnet): ~$0.062/次（Top15 深度 ~4000 tokens）
 *   每日總計 ~$0.065
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');

const logger = createLogger('processor:ai-analyzer');

// Claude 模型 ID（與 config.json anthropic 區塊對齊）
const MODELS = {
  haiku:  'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929'
};

class AIAnalyzer {
  constructor(config = {}) {
    this.apiKey      = process.env.ANTHROPIC_API_KEY || '';
    this.enabled     = !!this.apiKey;
    this.stage1Model = config.stage1Model || MODELS.haiku;
    this.stage2Model = config.stage2Model || MODELS.sonnet;

    if (this.enabled) {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
  }

  /**
   * 主分析方法
   * @param {object[]} newsItems    - 已去重 + 重要性評分的新聞陣列
   * @param {object}   marketData   - validator 輸出的 marketData 物件
   * @returns {Promise<AnalysisResult>}
   */
  async analyze(newsItems, marketData = {}) {
    if (!this.enabled) {
      logger.warn('ANTHROPIC_API_KEY not set, skipping AI analysis');
      return this._buildSkippedResult('no_api_key');
    }

    const budget = costLedger.checkBudget();
    if (budget.overBudget) {
      logger.warn(`over daily budget $${budget.budget}, skipping AI analysis`);
      return this._buildSkippedResult('over_budget', { budget });
    }

    if (!newsItems || newsItems.length === 0) {
      logger.warn('no news items, skipping AI analysis');
      return this._buildSkippedResult('no_news');
    }

    try {
      // Stage 1: Haiku 快速分級（最多 50 則）
      const inputForHaiku = newsItems.slice(0, 50);
      logger.info(`[Stage 1] Haiku ranking ${inputForHaiku.length} news items`);
      const stage1Result = await this._stage1Rank(inputForHaiku, marketData);

      // Stage 2: Sonnet 深度分析（Top 15）
      const top15 = stage1Result.ranked.slice(0, 15);
      logger.info(`[Stage 2] Sonnet deep analysis on ${top15.length} items`);
      const stage2Result = await this._stage2Analyze(top15, marketData);

      return {
        skipped: false,
        rankedNews:      stage1Result.ranked,
        dailySnapshot:   stage2Result.dailySnapshot,
        marketRegime:    stage2Result.marketRegime,
        structuralTheme: stage2Result.structuralTheme,
        keyInsights:     stage2Result.keyInsights
      };

    } catch (err) {
      logger.error(`AI analysis failed: ${err.message}`);
      return this._buildSkippedResult('error', { error: err.message });
    }
  }

  /**
   * Stage 1: Haiku — P0-P3 分級 + 簡短 AI 摘要
   */
  async _stage1Rank(newsItems, marketData) {
    const marketCtx = this._buildMarketContext(marketData);
    const newsList  = newsItems.map((n, i) =>
      `${i + 1}. [${n.importance || 'P3'}] ${n.title}${n.summary ? `（${n.summary.slice(0, 60)}）` : ''}`
    ).join('\n');

    const prompt = `你是投資分析師。請對以下 ${newsItems.length} 則今日市場新聞評估重要性等級，並為每則新聞提供 15 字以內的中文摘要。

市場背景：
${marketCtx}

新聞列表：
${newsList}

重要性評估標準：
- P0：影響全球市場方向（Fed/FOMC/CPI/GDP/央行/衰退/重大地緣政治）
- P1：影響重要個股（AI半導體/NVDA/TSMC/重大財報/M&A）
- P2：籌碼異動（外資大量買賣超/三大法人/融資變化）
- P3：一般市場資訊

請以 JSON 格式回傳（只要 JSON，不要其他說明）：
{
  "ranked": [
    {"index": 1, "priority": "P0", "title": "原標題", "aiSummary": "15字以內摘要"},
    ...
  ]
}

按 P0→P1→P2→P3 排序，同優先級內按重要性降序。`;

    const response = await this._callAPI(this.stage1Model, prompt, 2000);
    this._recordUsage('haiku', response.usage, newsItems.length);

    let ranked;
    try {
      const parsed = JSON.parse(this._extractJson(response.content));
      ranked = (parsed.ranked || []).map((r, idx) => ({
        ...(newsItems[r.index - 1] || newsItems[idx] || {}),
        importance: r.priority || 'P3',
        aiSummary:  r.aiSummary || ''
      }));
    } catch (err) {
      logger.warn(`Stage 1 JSON parse failed: ${err.message}, using rule-based ranking`);
      ranked = newsItems;
    }

    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    ranked.forEach(r => { counts[r.importance] = (counts[r.importance] || 0) + 1; });
    logger.info('[Stage 1] ranking complete', counts);

    return { ranked };
  }

  /**
   * Stage 2: Sonnet — Daily Snapshot + 深度分析
   */
  async _stage2Analyze(topNews, marketData) {
    const marketCtx = this._buildMarketContext(marketData);
    const newsList  = topNews.map((n, i) =>
      `${i + 1}. [${n.importance}] ${n.title}${n.aiSummary ? `（${n.aiSummary}）` : ''}`
    ).join('\n');

    const prompt = `你是資深市場策略師。根據以下市場數據和重要事件，生成今日市場分析。

今日市場數據：
${marketCtx}

重要事件（已按重要性排序）：
${newsList}

請以 JSON 格式回傳（只要 JSON，不要其他說明）：
{
  "dailySnapshot": "2-3句台灣投資人視角的今日市場總結。涵蓋：①台股表現 ②主要驅動因素 ③產業/個股亮點。每句不超過30字。",
  "marketRegime": "Risk-on 或 Risk-off 或 Neutral（必須是這三個之一）",
  "structuralTheme": "當前最主要的市場主題（例如：AI基礎設施、利率峰值、能源轉型、地緣風險等）",
  "keyInsights": [
    "3-5個關鍵洞察，每條不超過25字，聚焦對台股持股的具體影響"
  ]
}

注意：
- dailySnapshot 要具體，包含數字（指數漲跌 %、關鍵數據）
- marketRegime 根據 VIX、利率方向、整體市場情緒判斷
- structuralTheme 識別最影響當週市場的結構性主題
- keyInsights 要有操作參考價值`;

    const response = await this._callAPI(this.stage2Model, prompt, 1500);
    this._recordUsage('sonnet', response.usage, topNews.length);

    try {
      const parsed = JSON.parse(this._extractJson(response.content));
      logger.info('[Stage 2] deep analysis complete', {
        marketRegime:    parsed.marketRegime,
        structuralTheme: parsed.structuralTheme
      });
      return {
        dailySnapshot:   parsed.dailySnapshot   || '',
        marketRegime:    parsed.marketRegime     || 'Neutral',
        structuralTheme: parsed.structuralTheme  || '',
        keyInsights:     parsed.keyInsights      || []
      };
    } catch (err) {
      logger.warn(`Stage 2 JSON parse failed: ${err.message}`);
      return {
        dailySnapshot:   response.content.slice(0, 200),
        marketRegime:    'Neutral',
        structuralTheme: '',
        keyInsights:     []
      };
    }
  }

  /**
   * 組合市場數字背景（給 LLM 的 prompt 用）
   */
  _buildMarketContext(marketData) {
    const lines = [];
    const fmt = (val, suffix = '') => val != null ? `${val}${suffix}` : 'N/A';
    const fmtPct = (pct) => pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '';

    if (marketData.TAIEX?.value != null) {
      lines.push(`台股加權：${fmt(marketData.TAIEX.value)} ${fmtPct(marketData.TAIEX.changePct)}${marketData.TAIEX.degraded ? ` [${marketData.TAIEX.degraded}]` : ''}`);
    }
    if (marketData.SP500?.value != null) {
      lines.push(`S&P 500：${fmt(marketData.SP500.value)} ${fmtPct(marketData.SP500.changePct)}`);
    }
    if (marketData.NASDAQ?.value != null) {
      lines.push(`Nasdaq：${fmt(marketData.NASDAQ.value)} ${fmtPct(marketData.NASDAQ.changePct)}`);
    }
    if (marketData.VIX?.value != null) {
      lines.push(`VIX：${fmt(marketData.VIX.value)}`);
    }
    if (marketData.US10Y?.value != null) {
      lines.push(`US 10Y：${fmt(marketData.US10Y.value)}%`);
    }
    if (marketData.DXY?.value != null) {
      lines.push(`DXY：${fmt(marketData.DXY.value)}`);
    }
    if (marketData.USDTWD?.value != null) {
      lines.push(`USD/TWD：${fmt(marketData.USDTWD.value)}`);
    }
    if (marketData.GOLD?.value != null) {
      lines.push(`黃金：$${fmt(marketData.GOLD.value)}`);
    }
    if (marketData.OIL_WTI?.value != null) {
      lines.push(`WTI 原油：$${fmt(marketData.OIL_WTI.value)}`);
    }

    return lines.length > 0 ? lines.join('\n') : '市場數據暫無';
  }

  /**
   * 呼叫 Anthropic API（使用官方 SDK）
   */
  async _callAPI(model, prompt, maxTokens = 1000) {
    const message = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });

    return {
      content: message.content[0].text,
      usage: {
        input_tokens:  message.usage.input_tokens,
        output_tokens: message.usage.output_tokens
      }
    };
  }

  /**
   * 從 LLM 回應中提取 JSON
   */
  _extractJson(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock) return codeBlock[1];
    const start = trimmed.indexOf('{');
    const end   = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
    throw new Error('no JSON found in response');
  }

  /**
   * 記錄 API 使用量到 CostLedger
   */
  _recordUsage(model, usage, newsCount) {
    if (!usage) return;
    // CostLedger.recordLlmUsage 兼容格式
    if (typeof costLedger.recordLlmUsage === 'function') {
      costLedger.recordLlmUsage(model, usage);
    } else {
      // fallback：直接記錄 API call
      costLedger.recordApiCall('anthropic', 1);
    }
    logger.debug(`${model} usage: in=${usage.input_tokens} out=${usage.output_tokens} news=${newsCount}`);
  }

  _buildSkippedResult(reason, extra = {}) {
    return {
      skipped: true,
      reason,
      rankedNews:      [],
      dailySnapshot:   '',
      marketRegime:    'Neutral',
      structuralTheme: '',
      keyInsights:     [],
      ...extra
    };
  }
}

// 單例
const aiAnalyzer = new AIAnalyzer();

module.exports = aiAnalyzer;
module.exports.AIAnalyzer = AIAnalyzer;
