// Perplexity Plugin — News Fetch
// 使用 Perplexity Sonar API 取得「已整理的市場重點 + 引用來源」

const https = require('https');
const path = require('path');
const DataSourceAdapter = require('../../adapter');
const CacheManager = require('../../../../shared/cache-manager');
const rateLimiter = require('../../../../shared/rate-limiter');
const costLedger = require('../../../cost-ledger');
const { createLogger } = require('../../../../shared/logger');

const logger = createLogger('perplexity-plugin');

class PerplexityPlugin extends DataSourceAdapter {
  constructor(config = {}) {
    super('Perplexity', config);
    this.apiKey = process.env.PERPLEXITY_API_KEY;
    this.model = config.model || 'sonar';
    this.baseUrl = config.baseUrl || 'https://api.perplexity.ai';
    this.cache = new CacheManager(
      path.join(__dirname, '../../../../data/news-cache'),
      { logger }
    );
    this.cacheTtl = config.cacheTtl || 1800000; // 30 分鐘
  }

  /**
   * Plugin 統一介面：fetch
   */
  async fetch() {
    if (!this.apiKey) {
      logger.warn('PERPLEXITY_API_KEY 未設定，跳過');
      return { news: [], source: 'perplexity', skipped: true };
    }

    // 預算檢查
    const budget = costLedger.checkBudget();
    if (budget.overBudget) {
      logger.warn(`每日預算已超過 ($${budget.spent}/$${budget.budget})，跳過 Perplexity`);
      return { news: [], source: 'perplexity', skipped: true, reason: 'budget' };
    }

    // 快取檢查（30 分鐘內不重複查詢）
    const cacheKey = `perplexity-news-${new Date().toISOString().slice(0, 13)}`;
    const cached = this.cache.get(cacheKey, this.cacheTtl);
    if (cached) {
      logger.info('使用 Perplexity 快取');
      return cached;
    }

    return this.withRetry(async () => {
      await rateLimiter.acquire('perplexity');
      costLedger.recordApiCall('perplexity');

      const result = await this._callSonarApi();
      const news = this._parseResponse(result);

      const output = { news, source: 'perplexity', fetchedAt: new Date().toISOString() };
      this.cache.set(cacheKey, output, { pretty: true });

      logger.info(`Perplexity 取得 ${news.length} 則新聞`);
      return output;
    }, 2, { news: [], source: 'perplexity', skipped: true, reason: 'error' });
  }

  /**
   * 呼叫 Perplexity Sonar API
   */
  _callSonarApi() {
    const prompt = `今日影響股市最大的 5 件事，從投資人角度分析：
1. 對美股主要持股（NVDA, AAPL, MSFT, QQQ, SPY）的影響
2. 對台股（台積電、AI 族群）的影響
3. 總經政策信號（Fed, CPI, GDP）
4. 重大財報/法說會
請附具體數據和引用來源。以 JSON 格式回傳，每則包含 title, summary, impact, sources 欄位。`;

    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: '你是專業的金融市場分析師，專注美股和台股。回傳 JSON 陣列格式。' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2000,
      return_citations: true
    });

    return new Promise((resolve, reject) => {
      const url = new URL('/chat/completions', this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Perplexity JSON parse error: ${e.message}`));
            }
          } else {
            reject(new Error(`Perplexity API ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Perplexity API timeout (30s)'));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * 解析 Perplexity 回應為統一 news-v1 格式
   */
  _parseResponse(apiResponse) {
    try {
      const content = apiResponse.choices?.[0]?.message?.content || '';
      const citations = apiResponse.citations || [];

      // 嘗試解析 JSON
      let items = [];
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          items = JSON.parse(jsonMatch[0]);
        } catch (e) {
          // 解析失敗，用整段文字當成單一新聞
        }
      }

      if (items.length === 0) {
        // 無法解析 JSON，把整段內容當成一則摘要新聞
        items = [{
          title: '今日市場重點摘要（Perplexity）',
          summary: content,
          impact: 'high',
          sources: citations
        }];
      }

      return items.map((item, idx) => ({
        title: item.title || `市場要聞 #${idx + 1}`,
        source: 'Perplexity Sonar',
        sourceId: 'perplexity',
        category: 'Research',
        link: item.sources?.[0] || citations[idx] || '',
        pubDate: new Date().toISOString(),
        description: item.summary || item.description || '',
        impact: item.impact || 'medium',
        citations: item.sources || [],
        guid: `perplexity-${Date.now()}-${idx}`
      }));
    } catch (e) {
      logger.error('Perplexity 解析失敗', e);
      return [];
    }
  }

  async fetchNews() {
    const result = await this.fetch();
    return result.news || [];
  }

  async fetchMarketData() {
    return null; // Perplexity 不提供結構化市場數據
  }
}

module.exports = PerplexityPlugin;
