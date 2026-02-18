/**
 * TWSECollector — 台灣證交所資料收集器
 * 負責：加權指數、三大法人買賣超、融資融券餘額
 * 優先級：TWSE（主）> FinMind（交叉比對）
 *
 * Phase 2 使用（07:30 台股收集）
 */

'use strict';

const https = require('https');
const BaseCollector = require('./base-collector');

const TWSE_BASE = 'https://openapi.twse.com.tw/v1';
const TWSE_FUND = 'https://www.twse.com.tw/rwd/zh/fund';
const CACHE_TTL = 3600000; // 1h

class TWSECollector extends BaseCollector {
  constructor(config = {}) {
    super('twse', config);
    this.apiConfig = config.dataSources?.api?.twse || {};
  }

  /**
   * 主收集方法
   * @returns {{ date, source, TAIEX, taiexVolume, institutional, margin, topMovers }}
   */
  async collect() {
    const today = this._todayStr();
    const cacheKey = `twse-daily-${today}`;

    return this.withCache(cacheKey, CACHE_TTL, async () => {
      this.logger.info('collecting TWSE data');
      this.costLedger.recordApiCall('twse', 3);

      const [indexData, institutionalData, marginData] = await Promise.allSettled([
        this.withRetry(() => this._fetchIndex(today), 3, null),
        this.withRetry(() => this._fetchInstitutional(today), 3, null),
        this.withRetry(() => this._fetchMargin(today), 2, null)
      ]);

      const result = {
        date:     today,
        source:   'twse',
        fetchedAt: new Date().toISOString()
      };

      // 加權指數
      const idx = indexData.status === 'fulfilled' ? indexData.value : null;
      if (idx) {
        result.TAIEX = this.makeDataPoint(idx.close, {
          change:    idx.change,
          changePct: idx.changePct,
          source:    'twse'
        });
        result.taiexVolume = idx.volume; // 億元
      } else {
        result.TAIEX = { value: null, degraded: 'NA', source: 'twse', fetchedAt: new Date().toISOString() };
        this.logger.warn('TAIEX fetch failed, degraded to NA');
      }

      // 三大法人
      const inst = institutionalData.status === 'fulfilled' ? institutionalData.value : null;
      if (inst) {
        result.institutional = {
          foreign:   inst.foreign,
          trust:     inst.trust,
          dealer:    inst.dealer,
          fetchedAt: new Date().toISOString()
        };
      }

      // 融資融券
      const margin = marginData.status === 'fulfilled' ? marginData.value : null;
      if (margin) {
        result.margin = {
          marginBalance:   margin.marginBalance,
          shortBalance:    margin.shortBalance,
          marginChangePct: margin.marginChangePct,
          fetchedAt:       new Date().toISOString()
        };
      }

      return result;
    });
  }

  /** 加權指數（TWSE openapi） */
  async _fetchIndex(date) {
    const data = await this._get(`${TWSE_BASE}/exchangeReport/STOCK_DAY_ALL`);
    // TWSE STOCK_DAY_ALL 不含大盤指數，改用 MI_INDEX
    const miData = await this._get(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?type=IND&date=${date.replace(/-/g, '')}`);

    if (!miData || !miData.data) return null;

    // 找加權指數（代碼 Y999）
    const row = miData.data.find(r => r[0] === 'Y999' || r[1] === '加權股價指數');
    if (!row) return null;

    const close  = parseFloat(row[4]?.replace(/,/g, '') || '0');
    const change = parseFloat(row[7]?.replace(/,/g, '').replace(/▲|▼/g, m => m === '▲' ? '' : '-') || '0');
    const volume = parseFloat(row[2]?.replace(/,/g, '') || '0') / 100; // 轉換為億元

    return { close, change, changePct: close ? (change / (close - change)) * 100 : 0, volume };
  }

  /** 三大法人買賣超（BFI82U） */
  async _fetchInstitutional(date) {
    const dateStr = date.replace(/-/g, '');
    const url = `${TWSE_FUND}/BFI82U?dayDate=${dateStr}&type=day`;
    const data = await this._get(url);

    if (!data || !data.data) return null;

    let foreign = 0, trust = 0, dealer = 0;
    for (const row of data.data) {
      const name = row[0];
      const net = parseInt((row[4] || '0').replace(/,/g, ''), 10);
      if (name.includes('外資') || name.includes('Foreign')) foreign += net;
      else if (name.includes('投信') || name.includes('Investment')) trust += net;
      else if (name.includes('自營') || name.includes('Dealer')) dealer += net;
    }

    return { foreign, trust, dealer };
  }

  /** 融資融券（MI_MARGN） */
  async _fetchMargin(date) {
    const data = await this._get(`${TWSE_BASE}/exchangeReport/MI_MARGN`);
    if (!data || !Array.isArray(data)) return null;

    // 取第一筆（最新日期）
    const row = data[0];
    if (!row) return null;

    return {
      marginBalance:   parseFloat((row.marginBalance || '0').replace(/,/g, '')) / 100, // 億元
      shortBalance:    parseFloat((row.shortBalance  || '0').replace(/,/g, '')),
      marginChangePct: 0 // TODO: 計算日變化
    };
  }

  /** HTTP GET 輔助函數（簡單版，無需 axios） */
  _get(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'MarketDigest/2.0 (pipeline@example.com)' },
        timeout: 10000
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  _todayStr() {
    return new Date().toISOString().slice(0, 10);
  }
}

module.exports = TWSECollector;
