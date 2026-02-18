/**
 * SECEdgarCollector — SEC EDGAR 申報文件收集器
 * 負責：監控過去 24h 重大申報（8-K / 13F / 4 / 10-K / 10-Q）
 * 聚焦：Watchlist 中的美股公司 + 重大事件
 *
 * API: https://efts.sec.gov（免費，無需 API Key）
 * Auth: User-Agent header（需包含郵箱）
 * Rate Limit: 10 req/sec（intervalMs: 100）
 *
 * Phase 1 使用（05:30 美股收集階段）
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');

const EDGAR_SUBMISSIONS = 'https://data.sec.gov/submissions/';
const EDGAR_EFTS        = 'https://efts.sec.gov/LATEST/search-index';
const CACHE_TTL = 1800000; // 30min
const LOOKBACK_HOURS = 24;

// Watchlist 公司 → CIK 映射（主要美股）
// CIK 查詢：https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=NVDA&type=&dateb=&owner=include&count=40
const WATCHLIST_CIK_MAP = {
  'NVDA':  '0001045810',
  'AAPL':  '0000320193',
  'MSFT':  '0000789019',
  'GOOGL': '0001652044',
  'AMZN':  '0001018724',
  'META':  '0001326801',
  'AVGO':  '0001730168',
  'TSM':   '0001046179',
  'AMD':   '0000002488',
  'NVDA':  '0001045810'
};

// 重要性評分規則（依申報類型）
const FILING_IMPORTANCE = {
  '8-K':  'P1',  // 重大事件（財報預告、CEO 異動、收購等）
  '13F':  'P2',  // 機構持股（季報）
  '4':    'P2',  // 內部人交易
  '10-K': 'P2',  // 年報
  '10-Q': 'P3'   // 季報
};

// 8-K 觸發詞 → 升級為 P0
const P0_TRIGGERS = ['merger', 'acquisition', 'bankruptcy', 'CEO', 'CTO', 'restatement', 'material weakness'];

class SECEdgarCollector extends BaseCollector {
  constructor(config = {}) {
    super('secEdgar', config);
    this.apiConfig = config.dataSources?.api?.secEdgar || {};
    this.filingTypes = this.apiConfig.filingTypes || ['8-K', '13F', '4'];
    this.userAgent   = process.env.SEC_EDGAR_USER_AGENT ||
                       this.apiConfig.userAgent?.replace('${SEC_EDGAR_USER_AGENT}', '') ||
                       'MarketDigest/2.0 admin@example.com';

    // 初始化 SEC rate limiter（100ms 間隔）
    this.rateLimiter.register('secEdgar', { intervalMs: 100 });
  }

  /**
   * 主收集方法
   * @returns {{ source, fetchedAt, filings: SecFiling[] }}
   */
  async collect() {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `sec-edgar-${today}-${new Date().getHours()}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting SEC EDGAR filings', { types: this.filingTypes });

      const filings = [];
      const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3600000);

      // 策略 1：全文搜尋最近申報（EFTS full-text search）
      for (const formType of this.filingTypes) {
        await this.rateLimiter.acquire('secEdgar');
        this.costLedger.recordApiCall('secEdgar', 1);

        const results = await this.withRetry(
          () => this._searchFilings(formType, cutoff),
          2, []
        );
        filings.push(...results);
      }

      // 策略 2：監控 Watchlist 公司的最近申報
      const watchlistFilings = await this._fetchWatchlistFilings(cutoff);
      filings.push(...watchlistFilings);

      // 去重（同一 accession number）
      const seen = new Set();
      const unique = filings.filter(f => {
        if (seen.has(f.accession)) return false;
        seen.add(f.accession);
        return true;
      });

      // 按時間降序 + 重要性排序
      unique.sort((a, b) => {
        const importanceOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
        const importanceDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
        if (importanceDiff !== 0) return importanceDiff;
        return new Date(b.filedAt) - new Date(a.filedAt);
      });

      this.logger.info(`SEC EDGAR: ${unique.length} filings in last ${LOOKBACK_HOURS}h`);

      return {
        source:    'secEdgar',
        fetchedAt: new Date().toISOString(),
        filings:   unique.slice(0, 30) // 最多 30 筆
      };
    });
  }

  /** 全文搜尋最近某類型的申報（EFTS API） */
  async _searchFilings(formType, cutoff) {
    const dateFrom = cutoff.toISOString().slice(0, 10);
    const url = `${EDGAR_EFTS}?q=%22${encodeURIComponent(formType)}%22&dateRange=custom&startdt=${dateFrom}&forms=${encodeURIComponent(formType)}&hits.hits._source=period_of_report,entity_name,file_date,form_type,biz_location,inc_states&hits.hits.total=true`;

    const data = await this._get(url);
    const hits = data?.hits?.hits || [];

    return hits.slice(0, 10).map(hit => {
      const src = hit._source || {};
      return this._makeFilingItem({
        formType:  src.form_type || formType,
        company:   src.entity_name || 'Unknown',
        cik:       hit._id?.split(':')[0] || '',
        filedAt:   src.file_date ? new Date(src.file_date).toISOString() : new Date().toISOString(),
        accession: hit._id || `${formType}-${Date.now()}-${Math.random()}`,
        url:       hit._id ? `https://www.sec.gov/Archives/edgar/data/${hit._id.replace(':', '/')}.txt` : ''
      });
    });
  }

  /** 監控 Watchlist 公司的最近申報（EDGAR Submissions API） */
  async _fetchWatchlistFilings(cutoff) {
    const filings = [];

    for (const [symbol, cik] of Object.entries(WATCHLIST_CIK_MAP)) {
      await this.rateLimiter.acquire('secEdgar');
      this.costLedger.recordApiCall('secEdgar', 1);

      const data = await this.withRetry(
        () => this._get(`${EDGAR_SUBMISSIONS}CIK${cik}.json`),
        2, null
      );

      if (!data?.filings?.recent) continue;

      const recent = data.filings.recent;
      const forms   = recent.form       || [];
      const dates   = recent.filingDate || [];
      const accnums = recent.accessionNumber || [];
      const company = data.name || symbol;

      for (let i = 0; i < forms.length; i++) {
        const filedAt = new Date(dates[i]);
        if (filedAt < cutoff) continue;
        if (!this.filingTypes.includes(forms[i])) continue;

        filings.push(this._makeFilingItem({
          formType:  forms[i],
          company:   `${symbol} (${company})`,
          cik:       cik.replace(/^0+/, ''),
          filedAt:   filedAt.toISOString(),
          accession: accnums[i] || '',
          url:       `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${(accnums[i] || '').replace(/-/g, '')}/`
        }));
      }
    }

    return filings;
  }

  /** 建立標準化 SecFiling 物件 */
  _makeFilingItem({ formType, company, cik, filedAt, accession, url }) {
    let importance = FILING_IMPORTANCE[formType] || 'P3';

    // 8-K 包含觸發詞時升為 P0
    if (formType === '8-K' && P0_TRIGGERS.some(t => company.toLowerCase().includes(t.toLowerCase()))) {
      importance = 'P0';
    }

    return {
      formType,
      company,
      cik,
      filedAt,
      accession,
      url,
      summary:    `${company} 提交 ${formType}`,
      importance
    };
  }

  _get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': this.userAgent, 'Accept': 'application/json' },
        timeout: 15000
      }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse: ${e.message} (url: ${url.slice(0, 80)})`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }
}

module.exports = SECEdgarCollector;
