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

// 產業白名單（美股+台股重點產業，AI 提取時需至少匹配 1 個關鍵字）
const INDUSTRY_WHITELIST = [
  // 核心科技類
  'AI', '人工智慧', 'Artificial Intelligence',
  '半導體', '晶片', 'Semiconductor', 'Chip',
  '雲端運算', '雲服務', 'Cloud Computing',
  '電動車', '新能源車', 'EV', 'Electric Vehicle',
  '生技', '生物科技', 'Biotech', 'Pharmaceuticals',
  '軟體', 'SaaS', 'Software',
  '網路安全', '資安', 'Cybersecurity',
  '5G', '通訊', 'Telecommunications',
  '伺服器', '資料中心', 'Data Center', 'Server',
  'PCB', '印刷電路板', 'Printed Circuit Board',
  // 台股供應鏈相關
  '面板', '顯示器', 'Display', 'Panel',
  '被動元件', '電子零組件', 'Electronic Components',
  '組裝代工', 'ODM', 'OEM', 'Contract Manufacturing',
  // 金融能源類
  '銀行', '金融服務', 'Banking', 'Financial Services',
  '保險', 'Insurance',
  '支付', '金融科技', 'FinTech', 'Payment',
  '石油', '天然氣', 'Oil', 'Natural Gas', 'Energy',
  '再生能源', '綠能', 'Renewable Energy', 'Solar', 'Wind',
  '電池', '儲能', 'Battery', 'Energy Storage',
  // 消費工業類
  '零售', '電商', 'Retail', 'E-commerce',
  '餐飲', '食品', 'Food', 'Beverage',
  '消費電子', 'Consumer Electronics',
  '製造', '工業自動化', 'Manufacturing', 'Automation',
  '航空', '國防', 'Aerospace', 'Defense',
  '運輸', '物流', 'Transportation', 'Logistics',
  // 原物料與其他
  '貴金屬', '黃金', 'Gold', 'Precious Metals',
  '工業金屬', '銅', 'Copper', 'Industrial Metals',
  '農產品', '大宗商品', 'Commodities', 'Agriculture',
  '房地產', 'REITs', 'Real Estate',
  '醫療器材', '醫療服務', 'Medical Devices', 'Healthcare Services'
];

// 產業黑名單（娛樂/體育/政治/生活，完全排除）
const INDUSTRY_BLACKLIST = [
  '胡瓜', '綜藝', '演藝', '藝人', '明星', '電影', '戲劇', '偶像',
  '球賽', '選手', '運動員', '比賽', '奧運', '世界盃', 'NBA', 'MLB',
  '音樂', '演唱會', '歌手', 'KTV', '遊戲', '電競',
  '選舉', '投票', '候選人', '政黨', '立委', '議員', '市長', '總統',
  '抗議', '示威', '遊行', '罷工', '陳情', '請願',
  '旅遊', '觀光', '美食', '餐廳', '咖啡', '甜點',
  '學校', '大學', '考試', '升學', '補習班',
  '展覽', '博物館', '藝術', '文化節', '慶典'
];

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
        industryThemes:  stage2Result.industryThemes,
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

    const prompt = `你是投資分析師。請對以下 ${newsItems.length} 則今日市場新聞評估重要性等級、類別，並提供 15 字以內的中文摘要。

市場背景：
${marketCtx}

新聞列表：
${newsList}

重要性評估標準：
- P0：影響全球市場方向（Fed/FOMC/CPI/GDP/央行/衰退/重大地緣政治）
- P1：影響重要個股（AI半導體/NVDA/TSMC/重大財報/M&A）
- P2：籌碼異動（外資大量買賣超/三大法人/融資變化）
- P3：一般市場資訊

類別標籤（必須精確分類）：
- geopolitics: 地緣政治衝突、軍事行動、國際制裁、兩岸關係、戰爭風險
- structural: 產業結構變化、技術革新、監管政策、供應鏈調整
- equity: 個股財報、併購、高管變動、公司治理
- economic: 經濟數據（CPI/GDP/就業）、央行決策、利率變化

請以 JSON 格式回傳（只要 JSON，不要其他說明）：
{
  "ranked": [
    {
      "index": 1,
      "priority": "P0",
      "category": "geopolitics|structural|equity|economic",
      "title": "原標題",
      "aiSummary": "15字以內摘要"
    },
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
        category:   r.category || 'structural',  // 新增：保留 AI 分類的 category
        aiSummary:  r.aiSummary || ''
      }));
    } catch (err) {
      logger.warn(`Stage 1 JSON parse failed: ${err.message}, using rule-based ranking`);
      // Fallback：使用原始排序，並設定預設 category
      ranked = newsItems.map(item => ({
        ...item,
        category: item.category === 'Macro_Policy' || item.category === 'Equity_Market' ? 'structural' : (item.category || 'structural'),
        aiSummary: ''
      }));
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
  "industryThemes": [
    {
      "industry": "產業名稱（如 AI伺服器、電動車、生技藥）",
      "summary": "20字以內摘要，含關鍵公司動態",
      "keyCompanies": ["NVDA", "SMCI"]
    }
  ],
  "keyInsights": [
    "3-5個關鍵洞察，每條不超過25字，聚焦對台股持股的具體影響"
  ]
}

注意：
- dailySnapshot 要具體，包含數字（指數漲跌 %、關鍵數據）
- marketRegime 根據 VIX、利率方向、整體市場情緒判斷
- structuralTheme 識別最影響當週市場的結構性主題
- industryThemes 提取 2-3 個當日最熱門產業，優先選擇台股相關（台積電、鴻海等供應鏈）
- keyInsights 要有操作參考價值`;

    const response = await this._callAPI(this.stage2Model, prompt, 1500);
    this._recordUsage('sonnet', response.usage, topNews.length);

    try {
      const parsed = JSON.parse(this._extractJson(response.content));

      // 產業白名單+黑名單驗證（寬鬆模式：允許 1 個「其他」）
      const validatedIndustries = this._validateIndustryThemes(parsed.industryThemes || []);

      logger.info('[Stage 2] deep analysis complete', {
        marketRegime:    parsed.marketRegime,
        structuralTheme: parsed.structuralTheme,
        industries:      validatedIndustries.length
      });
      return {
        dailySnapshot:   parsed.dailySnapshot   || '',
        marketRegime:    parsed.marketRegime     || 'Neutral',
        structuralTheme: parsed.structuralTheme  || '',
        industryThemes:  validatedIndustries,
        keyInsights:     parsed.keyInsights      || []
      };
    } catch (err) {
      logger.warn(`Stage 2 JSON parse failed: ${err.message}`);
      return {
        dailySnapshot:   response.content.slice(0, 200),
        marketRegime:    'Neutral',
        structuralTheme: '',
        industryThemes:  [],
        keyInsights:     []
      };
    }
  }

  /**
   * 產業白名單+黑名單驗證（寬鬆模式）
   * @param {Array} aiIndustryThemes - AI 提取的產業主題列表
   * @returns {Array} 驗證通過的產業列表
   */
  _validateIndustryThemes(aiIndustryThemes) {
    if (!Array.isArray(aiIndustryThemes)) return [];

    const validated = [];
    let otherCount = 0;
    const maxOtherAllowed = 1;  // 寬鬆模式：允許 1 個「其他」

    for (const theme of aiIndustryThemes) {
      if (!theme || !theme.industry) continue;

      const industry = theme.industry.toLowerCase();

      // 1. 黑名單檢查（優先）
      const isBlacklisted = INDUSTRY_BLACKLIST.some(kw => industry.includes(kw.toLowerCase()));
      if (isBlacklisted) {
        logger.warn(`[Validator] Rejected blacklisted industry: ${theme.industry}`);
        continue;  // 完全排除
      }

      // 2. 白名單檢查
      const isWhitelisted = INDUSTRY_WHITELIST.some(kw => industry.includes(kw.toLowerCase()));
      if (isWhitelisted) {
        validated.push({ ...theme, validated: true });
        continue;
      }

      // 3. 寬鬆模式：允許 1 個「其他」
      if (otherCount < maxOtherAllowed) {
        validated.push({ ...theme, validated: false, tag: '其他' });
        otherCount++;
        logger.info(`[Validator] Allowed "other" industry: ${theme.industry}`);
      } else {
        logger.warn(`[Validator] Rejected (exceeded "other" quota): ${theme.industry}`);
      }
    }

    return validated;
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
