/**
 * PerplexityCollector — Perplexity Sonar 收集器
 * 負責：固定查詢（今日重點5件事）+ 動態查詢（Phase 1 熱點）+ 地緣政治觸發
 *
 * Phase 2 使用（07:30），需搭配 Phase 1 結果做動態查詢
 *
 * API: https://api.perplexity.ai
 * Auth: PERPLEXITY_API_KEY 環境變數
 * Model: sonar（免費 / 付費包月）
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');
const { getApiKeys } = require('../shared/api-keys');

const PERPLEXITY_BASE = 'https://api.perplexity.ai';
const CACHE_TTL = 1800000; // 30min
const MAX_RETRIES = 2;

class PerplexityCollector extends BaseCollector {
  constructor(config = {}) {
    super('perplexity', config);
    this.apiConfig = config.dataSources?.api?.perplexity || {};
    this.queriesConfig = config.perplexityQueries || {};

    // 統一 API key 管理
    const apiKeys = getApiKeys();
    this.apiKey = apiKeys.getPerplexity();

    this.model = this.apiConfig.model || 'sonar';
  }

  /**
   * 主收集方法
   * @param {object} [phase1Context] - Phase 1 結果，用於動態查詢
   * @returns {{ source, fetchedAt, news: NewsItem[], queries: object }}
   */
  async collect(phase1Context = null) {
    if (!this.apiKey) {
      this.logger.warn('PERPLEXITY_API_KEY not set, skipping Perplexity collection');
      return { source: 'perplexity', error: 'no_api_key', news: [], fetchedAt: new Date().toISOString() };
    }

    // 預算檢查
    const budget = this.costLedger.checkBudget();
    if (budget.overBudget) {
      this.logger.warn(`budget exceeded ($${budget.spent}/$${budget.budget}), skipping Perplexity`);
      return { source: 'perplexity', error: 'over_budget', news: [], fetchedAt: new Date().toISOString() };
    }

    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `perplexity-${today}-${new Date().getHours()}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting Perplexity data');
      const allNews = [];
      const queryResults = { fixed: [], dynamic: [], geopolitics: [] };

      // 1. 固定查詢
      const fixedQuery = this.queriesConfig.fixed?.[0] || '今日全球金融市場最重要的5件事，包含美股、台股、總經、地緣政治';
      await this.rateLimiter.acquire('perplexity');
      const fixedResult = await this.withRetry(() => this._callSonar(fixedQuery), MAX_RETRIES, null);
      if (fixedResult) {
        this.costLedger.recordApiCall('perplexity', 1);
        const items = this._parseToNewsItems(fixedResult, 'fixed_query', 'Macro_Policy');
        allNews.push(...items);
        queryResults.fixed = items.map(n => n.title);
      }

      // 2. 動態查詢（根據 Phase 1 熱點）
      if (phase1Context && this.queriesConfig.dynamic?.enabled) {
        const dynamicQuery = this._buildDynamicQuery(phase1Context);
        if (dynamicQuery) {
          await this.rateLimiter.acquire('perplexity');
          const dynResult = await this.withRetry(() => this._callSonar(dynamicQuery), MAX_RETRIES, null);
          if (dynResult) {
            this.costLedger.recordApiCall('perplexity', 1);
            const items = this._parseToNewsItems(dynResult, 'dynamic_query', 'Structural_Theme');
            allNews.push(...items);
            queryResults.dynamic = items.map(n => n.title);
          }
        }
      }

      // 3. 地緣政治（條件觸發：headlines 含觸發關鍵字）
      if (this.queriesConfig.geopolitics?.enabled) {
        const shouldTrigger = this._shouldTriggerGeopolitics(allNews);
        if (shouldTrigger) {
          const geoQuery = this.queriesConfig.geopolitics.query || '最新地緣政治風險事件對金融市場的影響';
          await this.rateLimiter.acquire('perplexity');
          const geoResult = await this.withRetry(() => this._callSonar(geoQuery), MAX_RETRIES, null);
          if (geoResult) {
            this.costLedger.recordApiCall('perplexity', 1);
            const items = this._parseToNewsItems(geoResult, 'geopolitics', 'Geopolitics');
            allNews.push(...items);
            queryResults.geopolitics = items.map(n => n.title);
          }
        }
      }

      this.logger.info(`Perplexity collected ${allNews.length} items`);

      return {
        source:    'perplexity',
        fetchedAt: new Date().toISOString(),
        news:      allNews,
        queries:   queryResults
      };
    });
  }

  /** 根據 Phase 1 熱點生成動態查詢 */
  _buildDynamicQuery(phase1Context) {
    // 提取 Phase 1 的重要 headlines（P0/P1 等級）
    const topNews = (phase1Context.news || [])
      .filter(n => ['P0', 'P1'].includes(n.importance))
      .slice(0, 3)
      .map(n => n.title);

    if (!topNews.length) return null;

    return `以下是今日重要財經事件，請深度分析對市場的影響：${topNews.join('；')}`;
  }

  /** 判斷是否觸發地緣政治查詢 */
  _shouldTriggerGeopolitics(news) {
    const triggerKws = this.queriesConfig.geopolitics?.triggerKeywords ||
      ['戰爭', '制裁', '關稅', '地震', '海峽', 'war', 'sanction', 'tariff'];
    const text = news.map(n => `${n.title} ${n.summary}`).join(' ').toLowerCase();
    return triggerKws.some(kw => text.includes(kw.toLowerCase()));
  }

  /** 呼叫 Perplexity Sonar API */
  async _callSonar(query) {
    const body = JSON.stringify({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: '你是一位專業的財經分析師。請用繁體中文提供精準、結構化的市場分析。每個重點用獨立段落描述，格式為：標題 | 簡要說明。'
        },
        { role: 'user', content: query }
      ],
      max_tokens: 1024,
      temperature: 0.3,
      return_citations: true
    });

    const data = await this._post(`${PERPLEXITY_BASE}/chat/completions`, body);
    if (!data?.choices?.[0]?.message?.content) throw new Error('empty response');

    return {
      content:   data.choices[0].message.content,
      citations: data.citations || []
    };
  }

  /** 將 Sonar 回應解析為 NewsItem 陣列 */
  _parseToNewsItems(response, queryType, category) {
    const { content, citations } = response;
    const items = [];

    // 嘗試按行分割（每行一個重點）
    const lines = content.split('\n')
      .map(l => l.replace(/^[\d\.\-\*\s]+/, '').trim())
      .filter(l => l.length > 10);

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i];
      const [titlePart, summaryPart] = line.includes(' | ') ? line.split(' | ', 2) : [line, ''];

      items.push(this.makeNewsItem({
        id:          `perplexity-${queryType}-${i}-${Date.now()}`,
        title:       titlePart.slice(0, 150),
        summary:     summaryPart || titlePart.slice(0, 300),
        source:      'perplexity',
        url:         citations[i] || '',
        publishedAt: new Date().toISOString(),
        importance:  'P1',
        category
      }));
    }

    return items;
  }

  _post(url, body) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        path:     parsed.pathname,
        method:   'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 30000
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = PerplexityCollector;
