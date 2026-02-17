// Two-Stage Summarize — 用 Anthropic API 生成三版市場摘要
// Stage 1 (Haiku)：快速對所有新聞打 P0-P3 優先級，成本極低
// Stage 2 (Sonnet)：對 Top 10 精煉 → 30秒版 / 2分鐘版 / 話術版

const https = require('https');
const { createLogger } = require('../shared/logger');
const costLedger = require('./cost-ledger');

const logger = createLogger('two-stage-summarize');

class TwoStageSummarizer {
  constructor(config = {}) {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.baseUrl = 'api.anthropic.com';
    this.apiVersion = '2023-06-01';
    this.stage1Model = config.stage1Model || 'claude-haiku-4-5-20251001';
    this.stage2Model = config.stage2Model || 'claude-sonnet-4-5-20250929';
    this.enabled = !!(this.apiKey);
  }

  /**
   * 主入口：輸入所有新聞 + 市場數據，輸出三版摘要
   * @param {string[]} allNews - 所有新聞標題（LINE + Perplexity 合併後）
   * @param {Object} pipelineData - fetchPipeline() 的結果（含 FMP/FinMind 市場數據）
   * @returns {Object} { brief30s, brief2min, clientPitch, rankedNews, skipped }
   */
  async summarize(allNews, pipelineData = {}) {
    if (!this.enabled) {
      logger.warn('ANTHROPIC_API_KEY 未設定，跳過 Two-Stage Summarize');
      return { skipped: true, reason: 'no_api_key' };
    }

    if (!allNews || allNews.length === 0) {
      logger.warn('無新聞可摘要，跳過');
      return { skipped: true, reason: 'no_news' };
    }

    // 預算檢查
    const budget = costLedger.checkBudget();
    if (budget.overBudget) {
      logger.warn(`已超出每日預算 ($${budget.budget} USD)，跳過 Two-Stage Summarize`);
      return { skipped: true, reason: 'over_budget', budget };
    }

    try {
      // Stage 1: Haiku 快速排序（低成本）
      logger.info(`[Stage 1] Haiku 評估 ${allNews.length} 則新聞...`);
      const ranked = await this._stage1Rank(allNews, pipelineData);

      // Stage 2: Sonnet 精煉（top 10）
      const top10 = ranked.slice(0, 10);
      logger.info(`[Stage 2] Sonnet 精煉 ${top10.length} 則重要新聞...`);
      const summaries = await this._stage2Summarize(top10, pipelineData);

      return {
        skipped: false,
        rankedNews: ranked,
        ...summaries
      };
    } catch (err) {
      logger.error(`Two-Stage Summarize 失敗: ${err.message}`);
      return { skipped: true, reason: 'error', error: err.message };
    }
  }

  /**
   * Stage 1: Haiku 快速分類 + 排序
   */
  async _stage1Rank(allNews, pipelineData) {
    // 組合市場數字背景
    const marketContext = this._buildMarketContext(pipelineData);

    const prompt = `你是投資分析師，請評估以下 ${allNews.length} 則今日市場新聞的重要性。

市場背景：
${marketContext}

新聞列表：
${allNews.map((n, i) => `${i + 1}. ${n}`).join('\n')}

評估標準：
- P0：影響全球市場方向（Fed/FOMC/CPI/GDP/央行決議/衰退信號）
- P1：影響重要持股（AI/半導體/NVDA/台積電財報法說）
- P2：籌碼異動（外資大買賣超/三大法人）
- P3：一般市場消息

請以 JSON 格式回傳（只要 JSON，不要其他說明）：
{
  "ranked": [
    {"index": 1, "priority": "P0", "title": "原標題", "summary": "15字中文摘要"},
    ...
  ]
}

按照 P0→P1→P2→P3 順序排列，同一優先級內按重要性排序。`;

    const response = await this._callAPI(this.stage1Model, prompt, 1500);
    costLedger.recordLlmUsage('haiku', response.usage);

    try {
      const parsed = JSON.parse(this._extractJson(response.content));
      const ranked = parsed.ranked || [];
      logger.info(`[Stage 1] 排序完成：P0=${ranked.filter(r => r.priority === 'P0').length} P1=${ranked.filter(r => r.priority === 'P1').length} P2=${ranked.filter(r => r.priority === 'P2').length}`);
      return ranked;
    } catch (err) {
      logger.error(`[Stage 1] JSON 解析失敗: ${err.message}`);
      // 降級：直接返回原始列表，不排序
      return allNews.map((title, i) => ({ index: i + 1, priority: 'P3', title, summary: title.slice(0, 15) }));
    }
  }

  /**
   * Stage 2: Sonnet 精煉 Top 10 → 三版摘要
   */
  async _stage2Summarize(top10, pipelineData) {
    const marketContext = this._buildMarketContext(pipelineData);
    const newsText = top10.map((n, i) =>
      `${i + 1}. [${n.priority}] ${n.title}${n.summary ? `（${n.summary}）` : ''}`
    ).join('\n');

    const prompt = `你是資深投資分析師，今日最重要的市場事件如下：

市場數據：
${marketContext}

重點事件（按重要性排序）：
${newsText}

請從投資人角度生成三個版本的市場摘要，以 JSON 格式回傳（只要 JSON）：
{
  "brief30s": "30秒版，3-5個要點，每點加上適當 emoji，每點不超過 30 字，用換行分隔",
  "brief2min": "2分鐘版，3個段落：①今日總體方向 ②重要事件分析（含具體數字） ③對台股持股的影響。每段 3-5 行",
  "clientPitch": "話術版，用跟客戶面對面說話的自然語氣，完整 2-3 段，附關鍵數字，結尾給出短期操作建議"
}`;

    const response = await this._callAPI(this.stage2Model, prompt, 2000);
    costLedger.recordLlmUsage('sonnet', response.usage);

    try {
      const parsed = JSON.parse(this._extractJson(response.content));
      logger.info(`[Stage 2] 三版摘要生成完成`);
      return {
        brief30s: parsed.brief30s || '',
        brief2min: parsed.brief2min || '',
        clientPitch: parsed.clientPitch || ''
      };
    } catch (err) {
      logger.error(`[Stage 2] JSON 解析失敗: ${err.message}`);
      // 返回原始文字（不損壞報告）
      return {
        brief30s: response.content.slice(0, 300),
        brief2min: response.content.slice(0, 800),
        clientPitch: response.content.slice(0, 600)
      };
    }
  }

  /**
   * 組合市場數字背景（給 LLM 用）
   */
  _buildMarketContext(pipelineData) {
    const lines = [];

    // FMP 美股報價
    if (pipelineData.market && pipelineData.market.fmp && pipelineData.market.fmp.quotes) {
      const quotes = pipelineData.market.fmp.quotes;
      const keySymbols = ['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'TSM'];
      const parts = keySymbols
        .filter(s => quotes[s])
        .map(s => {
          const q = quotes[s];
          const sign = q.changesPercentage >= 0 ? '+' : '';
          return `${s} $${q.price}(${sign}${(q.changesPercentage || 0).toFixed(1)}%)`;
        });
      if (parts.length > 0) lines.push(`美股：${parts.join(' | ')}`);
    }

    // FinMind 台股
    if (pipelineData.market && pipelineData.market.finmind) {
      const fm = pipelineData.market.finmind;
      if (fm.taiex) {
        const sign = fm.taiex.change >= 0 ? '+' : '';
        lines.push(`台股加權：${fm.taiex.close}（${sign}${fm.taiex.change}）`);
      }
      if (fm.topMovers && fm.topMovers.length > 0) {
        const topForeign = fm.topMovers.slice(0, 3).map(m => {
          const sign = m.foreignNetBuy >= 0 ? '買超' : '賣超';
          return `${m.stockId}(外資${sign}${Math.abs(Math.round(m.foreignNetBuy / 1000))}張)`;
        });
        lines.push(`外資異動：${topForeign.join(' ')}`);
      }
    }

    // Yahoo 市場數據 fallback
    if (pipelineData.market && pipelineData.market.yahoo) {
      const yahoo = pipelineData.market.yahoo;
      if (yahoo.tw_stock) {
        lines.push(`台股（Yahoo）：${yahoo.tw_stock.close || 'N/A'}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '市場數據暫無';
  }

  /**
   * 呼叫 Anthropic API
   */
  async _callAPI(model, prompt, maxTokens = 1000) {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': this.apiVersion,
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve({
                content: parsed.content[0].text,
                usage: parsed.usage || {}
              });
            } catch (e) {
              reject(new Error(`Anthropic JSON parse error: ${e.message}`));
            }
          } else {
            reject(new Error(`Anthropic API ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(60000, () => {
        req.destroy();
        reject(new Error('Anthropic API timeout (60s)'));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * 從 LLM 回應中提取 JSON 字串
   * 處理 LLM 可能在 JSON 前後加上 ``` 或說明文字的情況
   */
  _extractJson(text) {
    // 嘗試直接解析
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }
    // 找 ```json ... ``` 區塊
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1];
    }
    // 找第一個 { 到最後一個 }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    throw new Error('無法從回應中提取 JSON');
  }
}

module.exports = TwoStageSummarizer;
