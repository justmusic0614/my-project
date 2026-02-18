/**
 * RSSCollector — RSS 新聞收集器
 * 負責：4 個 RSS 源的新聞抓取與標準化
 * 來源：Yahoo Finance TW / CNBC Business / CNBC Markets / 經濟日報
 *
 * Phase 2 使用（07:30 台股收集階段）
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');

const CACHE_TTL = 1800000; // 30min
const MAX_ITEMS_PER_SOURCE = 20;
const MAX_AGE_HOURS = 24;

// P0-P3 重要性關鍵字（與 config.importancePriority 對齊）
const IMPORTANCE_KEYWORDS = {
  P0: ['Fed', 'FOMC', 'CPI', 'GDP', '央行', '升息', '降息', '衰退', 'recession'],
  P1: ['財報', 'earnings', '法說會', 'NVIDIA', '台積電', 'TSMC', 'AI', '半導體', 'semiconductor'],
  P2: ['外資', '投信', '買超', '賣超', '融資', '融券', '指數', '美股', '台股']
};

class RSSCollector extends BaseCollector {
  constructor(config = {}) {
    super('rss', config);
    this.sources = config.dataSources?.rss || this._defaultSources();
  }

  /**
   * 主收集方法
   * @returns {{ source, fetchedAt, news: NewsItem[] }}
   */
  async collect() {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `rss-${today}-${new Date().getHours()}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting RSS news');
      this.costLedger.recordApiCall('rss', this.sources.length);

      const enabledSources = this.sources.filter(s => s.enabled !== false);

      // 並行抓取所有 RSS 源
      const fetches = enabledSources.map(src =>
        this.withRetry(() => this._fetchRSS(src), 2, [])
          .then(items => ({ source: src, items }))
          .catch(err => {
            this.logger.warn(`RSS fetch failed: ${src.id}`, { error: err.message });
            return { source: src, items: [] };
          })
      );

      const results = await Promise.all(fetches);

      // 合併、標準化、過濾
      const allNews = [];
      for (const { source, items } of results) {
        for (const item of items.slice(0, MAX_ITEMS_PER_SOURCE)) {
          const newsItem = this._normalize(item, source);
          if (newsItem && this._isRecent(newsItem.publishedAt)) {
            allNews.push(newsItem);
          }
        }
      }

      // 按時間降序
      allNews.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      this.logger.info(`collected ${allNews.length} RSS items from ${results.length} sources`);

      return {
        source:    'rss',
        fetchedAt: new Date().toISOString(),
        news:      allNews
      };
    });
  }

  /** 抓取單一 RSS 源並解析 */
  async _fetchRSS(src) {
    const xml = await this._getRaw(src.url);
    return this._parseXML(xml, src);
  }

  /** 簡易 RSS/XML 解析（避免引入 xml2js，使用 regex） */
  _parseXML(xml, src) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title   = this._extractTag(block, 'title');
      const link    = this._extractTag(block, 'link') || this._extractTag(block, 'guid');
      const pubDate = this._extractTag(block, 'pubDate');
      const desc    = this._extractTag(block, 'description') || this._extractTag(block, 'content:encoded');

      if (title) {
        items.push({ title, link, pubDate, description: this._stripHtml(desc || '') });
      }
    }
    return items;
  }

  _extractTag(str, tag) {
    const m = str.match(new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}(?:[^>]*)>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? (m[1] || m[2] || '').trim() : null;
  }

  _stripHtml(str) {
    return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().slice(0, 300);
  }

  /** 將 RSS item 標準化為 NewsItem */
  _normalize(item, src) {
    if (!item.title || item.title.length < 5) return null;

    const title = item.title.replace(/\s+/g, ' ').trim();
    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

    return this.makeNewsItem({
      id:          `${src.id}-${Buffer.from(title).toString('base64').slice(0, 12)}`,
      title,
      summary:     item.description || '',
      source:      src.id,
      url:         item.link || '',
      publishedAt,
      importance:  this._scoreImportance(title, item.description || ''),
      category:    src.category || 'General',
      keywords:    this._extractKeywords(title)
    });
  }

  /** 基於關鍵字評估重要性 P0-P3 */
  _scoreImportance(title, desc) {
    const text = `${title} ${desc}`.toLowerCase();
    for (const [level, keywords] of Object.entries(IMPORTANCE_KEYWORDS)) {
      if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
        return level;
      }
    }
    return 'P3';
  }

  /** 從標題提取關鍵字 */
  _extractKeywords(title) {
    const allKw = [].concat(...Object.values(IMPORTANCE_KEYWORDS));
    return allKw.filter(kw => title.toLowerCase().includes(kw.toLowerCase()));
  }

  /** 判斷是否在 24h 內 */
  _isRecent(isoDate) {
    const age = Date.now() - new Date(isoDate).getTime();
    return age < MAX_AGE_HOURS * 3600000;
  }

  /** HTTP GET，返回原始文字（RSS 是 XML） */
  _getRaw(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'MarketDigest/2.0 RSS Reader' },
        timeout: 10000
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _defaultSources() {
    return [
      { id: 'yahoo-tw',      name: 'Yahoo Finance 台股', url: 'https://tw.stock.yahoo.com/rss?category=tw-market', category: 'Taiwan_Market', enabled: true },
      { id: 'cnbc-business', name: 'CNBC Business',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', category: 'Equity_Market', enabled: true },
      { id: 'cnbc-investing', name: 'CNBC Markets',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069', category: 'Equity_Market', enabled: true },
      { id: 'udn-business',  name: '經濟日報',           url: 'https://money.udn.com/rssfeed/news/1001/5591/latest', category: 'Taiwan_Market', enabled: true }
    ];
  }
}

module.exports = RSSCollector;
