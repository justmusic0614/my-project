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
const TWSE_AFTER = 'https://www.twse.com.tw/rwd/zh/afterTrading';
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
        result.taiexVolume = idx.volume; // 成交金額（元）；renderer 以 /1e8 顯示為億元
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

  /** 加權指數（TWSE FMTQIK，MI_INDEX 為 fallback）
   *
   * FMTQIK 單一請求即含指數 + 漲跌 + 成交金額，優先使用。
   * 欄位：[日期, 成交股數, 成交金額, 成交筆數, 發行量加權股價指數, 漲跌點數]
   * 日期為民國年格式（115/08/25），需轉換後比對。
   *
   * MI_INDEX fallback 只有價格無成交量，回傳 volume: null。
   * 其回應結構為 { tables: [{ fields, data }] }，指數名稱為「發行量加權股價指數」。
   */
  async _fetchIndex(date) {
    const dateStr = date.replace(/-/g, '');

    // 主來源：FMTQIK
    const qik = await this._get(`${TWSE_AFTER}/FMTQIK?date=${dateStr}`)
      .catch(() => null);
    const qikRows = Array.isArray(qik?.data) ? qik.data : null;
    if (qikRows?.length) {
      const target = this._toRocDate(date);
      const row = qikRows.find(r => r[0] === target) || qikRows[qikRows.length - 1];
      const close  = this._parseNum(row?.[4]);
      const change = this._parseNum(row?.[5]);
      const volume = this._parseNum(row?.[2]); // 成交金額（元），renderer 會 /1e8 轉億元
      if (close != null) {
        return {
          close,
          change: change ?? 0,
          changePct: (change != null && close - change !== 0)
            ? (change / (close - change)) * 100 : 0,
          volume
        };
      }
    }

    // Fallback：MI_INDEX（無成交量）
    const miData = await this._get(
      `${TWSE_AFTER}/MI_INDEX?type=IND&date=${dateStr}`
    ).catch(() => null);

    const tables = Array.isArray(miData?.tables) ? miData.tables : [];
    for (const table of tables) {
      const rows = Array.isArray(table?.data) ? table.data : [];
      const row = rows.find(r => typeof r?.[0] === 'string' && r[0].includes('發行量加權股價指數'));
      if (!row) continue;

      const close = this._parseNum(row[1]);
      if (close == null) continue;

      // 漲跌符號包在 HTML 中（<p style='color:red'>+</p> / >-<），需另外判斷方向
      const isNegative = /[->]\s*-\s*</.test(row[2] || '') || String(row[2] || '').includes('-');
      const magnitude  = this._parseNum(row[3]);
      const change     = magnitude == null ? null : (isNegative ? -magnitude : magnitude);
      const changePct  = this._parseNum(row[4]);

      this.logger.info('TAIEX from MI_INDEX fallback (no volume)');
      return {
        close,
        change: change ?? 0,
        changePct: changePct != null
          ? (isNegative ? -Math.abs(changePct) : Math.abs(changePct))
          : 0,
        volume: null
      };
    }

    return null;
  }

  /** 西元日期 → 民國年格式（2026-08-25 → 115/08/25） */
  _toRocDate(date) {
    const [y, m, d] = date.split('-');
    return `${Number(y) - 1911}/${m}/${d}`;
  }

  /** 解析含千分位／HTML 的數字字串 */
  _parseNum(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  /** 三大法人買賣超（BFI82U）
   * 若今日數據尚未公布（收盤前 API 返回空），自動 fallback 到前一個交易日
   */
  async _fetchInstitutional(date) {
    const dateStr = date.replace(/-/g, '');
    const data = await this._get(`${TWSE_FUND}/BFI82U?dayDate=${dateStr}&type=day`);

    if (data?.data?.length > 0) {
      return this._parseInstitutional(data.data);
    }

    // 今日法人尚未公布（收盤前），fallback 到前一個交易日
    this.logger.info('institutional data not yet published, falling back to previous trading day');
    const prevDate = this._prevTradingDay(date);
    const prevData = await this._get(`${TWSE_FUND}/BFI82U?dayDate=${prevDate.replace(/-/g, '')}&type=day`);
    if (!prevData?.data?.length) return null;
    return this._parseInstitutional(prevData.data);
  }

  _parseInstitutional(rows) {
    let foreign = 0, trust = 0, dealer = 0;
    for (const row of rows) {
      const name = row[0];
      const net = parseInt((row[3] || '0').replace(/,/g, ''), 10);
      if (name.includes('外資') || name.includes('Foreign')) foreign += net;
      else if (name.includes('投信') || name.includes('Investment')) trust += net;
      else if (name.includes('自營') || name.includes('Dealer')) dealer += net;
    }
    return { foreign, trust, dealer };
  }

  /** 前一個交易日（跳過週末；台灣假日由 API 空數據自然處理） */
  _prevTradingDay(date) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() - 1);
    }
    return d.toISOString().slice(0, 10);
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

  /**
   * 取得 TAIFEX Put/Call Ratio
   * @returns {Promise<{value:number, asOf:string, fetchedAt:string, source:string}|null>}
   */
  async fetchPutCallRatio() {
    try {
      const data = await this._get('https://openapi.taifex.com.tw/v1/PutCallRatio');
      if (!Array.isArray(data) || data.length === 0) return null;

      // API 回傳最新的一筆
      const latest = data[0];
      const pcRatio = parseFloat(latest.PutVolume) / parseFloat(latest.CallVolume);
      if (isNaN(pcRatio)) return null;

      return {
        value: pcRatio,
        asOf: latest.Date || this._todayStr(),
        fetchedAt: new Date().toISOString(),
        source: 'taifex'
      };
    } catch (err) {
      this.logger.warn(`Put/Call Ratio fetch failed: ${err.message}`);
      return null;
    }
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
