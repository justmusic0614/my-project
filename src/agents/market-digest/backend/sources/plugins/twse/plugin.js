/**
 * TWSE (台灣證交所) Plugin
 * 抓取三大法人買賣超數據
 */

const https = require('https');
const http = require('http');
const path = require('path');
const timeHelper = require(path.join(__dirname, '../../../../time-helper'));

class TWSEPlugin {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'https://www.twse.com.tw';
    this.timeout = config.timeout || 15000;
  }

  /**
   * 抓取三大法人買賣超數據（整體市場匯總）
   * @param {string} date - YYYYMMDD 格式（選填，預設今天）
   * @returns {Object} 三大法人數據
   */
  async fetchInstitutionalInvestors(date = null) {
    if (!date) {
      date = this.getTodayDate();
    }
    
    // 智慧時間判斷：盤中時自動使用前一交易日
    const effectiveDate = timeHelper.getEffectiveQueryDate(date);
    if (effectiveDate !== date) {
      console.log(`[TWSE] 盤中查詢，使用前一交易日: ${date} → ${effectiveDate}`);
      date = effectiveDate;
    }

    // 使用 BFI82U 端點取得整體市場匯總數據
    const url = `${this.baseUrl}/rwd/zh/fund/BFI82U?response=json&dayDate=${date}`;
    
    try {
      console.log(`[TWSE] 抓取三大法人數據: ${date}`);
      const data = await this.httpGet(url);
      
      if (!data || data.stat !== 'OK' || !data.data || data.data.length === 0) {
        console.warn(`[TWSE] 無數據: ${date}（可能非交易日）`);
        return this.getDefaultData();
      }

      return this.parseInstitutionalData(data);
    } catch (error) {
      console.error(`[TWSE] 抓取失敗:`, error.message);
      return this.getDefaultData();
    }
  }

  /**
   * 抓取最近N個交易日的三大法人數據
   * @param {number} days - 天數
   * @returns {Array} 歷史數據
   */
  async fetchHistoricalInstitutionalInvestors(days = 5) {
    const results = [];
    let attempts = 0;
    const maxAttempts = days * 2; // 考慮週末/假日，最多嘗試兩倍天數

    for (let i = 0; i < maxAttempts && results.length < days; i++) {
      const date = this.getDateOffset(-i);
      const data = await this.fetchInstitutionalInvestors(date);
      
      if (data.hasData) {
        results.push({ date, ...data });
      }

      // 避免過度請求
      await this.sleep(300);
    }

    return results;
  }

  /**
   * 解析三大法人數據（BFI82U 格式）
   */
  parseInstitutionalData(data) {
    if (!data.data || data.data.length === 0) {
      return this.getDefaultData();
    }

    // BFI82U 資料格式：
    // data.data = [
    //   ["自營商(自行買賣)", "買進金額", "賣出金額", "買賣差額"],
    //   ["自營商(避險)", ...],
    //   ["投信", ...],
    //   ["外資及陸資(不含外資自營商)", ...],
    //   ["外資自營商", ...],
    //   ["合計", ...]
    // ]
    
    // 找出三大法人的索引
    const foreignIndex = data.data.findIndex(row => 
      row[0] && row[0].includes('外資') && row[0].includes('不含')
    );
    const trustIndex = data.data.findIndex(row => 
      row[0] && row[0].includes('投信')
    );
    const dealerSelfIndex = data.data.findIndex(row => 
      row[0] && row[0].includes('自營商') && row[0].includes('自行買賣')
    );
    const dealerHedgeIndex = data.data.findIndex(row => 
      row[0] && row[0].includes('自營商') && row[0].includes('避險')
    );

    // 解析數據
    const foreign = this.parseRow(data.data[foreignIndex]);
    const trust = this.parseRow(data.data[trustIndex]);
    const dealerSelf = this.parseRow(data.data[dealerSelfIndex]);
    const dealerHedge = this.parseRow(data.data[dealerHedgeIndex]);
    
    // 合併自營商（自行買賣 + 避險）
    const dealer = {
      buy: dealerSelf.buy + dealerHedge.buy,
      sell: dealerSelf.sell + dealerHedge.sell,
      net: dealerSelf.net + dealerHedge.net
    };

    return {
      hasData: true,
      foreign: {
        buy: foreign.buy,
        sell: foreign.sell,
        net: foreign.net,
        netAmount: this.formatAmount(foreign.net),
        trend: this.calculateTrend(foreign.net)
      },
      trust: {
        buy: trust.buy,
        sell: trust.sell,
        net: trust.net,
        netAmount: this.formatAmount(trust.net),
        trend: this.calculateTrend(trust.net)
      },
      dealer: {
        buy: dealer.buy,
        sell: dealer.sell,
        net: dealer.net,
        netAmount: this.formatAmount(dealer.net),
        trend: this.calculateTrend(dealer.net)
      },
      total: {
        net: foreign.net + trust.net + dealer.net,
        netAmount: this.formatAmount(foreign.net + trust.net + dealer.net)
      }
    };
  }

  /**
   * 解析單行數據（BFI82U 格式）
   */
  parseRow(row) {
    if (!row || row.length < 4) {
      return { buy: 0, sell: 0, net: 0 };
    }

    // row[1] = 買進金額（元）
    // row[2] = 賣出金額（元）
    // row[3] = 買賣差額（元）
    // 1 億 = 100,000,000 元
    const buy = this.parseNumber(row[1]) / 100000000;   // 轉換為億元
    const sell = this.parseNumber(row[2]) / 100000000;  // 轉換為億元
    const net = this.parseNumber(row[3]) / 100000000;   // 轉換為億元
    
    return { buy, sell, net };
  }

  /**
   * 解析數字（處理千分位逗號）
   */
  parseNumber(str) {
    if (!str) return 0;
    return parseFloat(str.toString().replace(/,/g, ''));
  }

  /**
   * 格式化金額（億元）
   */
  formatAmount(value) {
    const absValue = Math.abs(value);
    const sign = value >= 0 ? '買超' : '賣超';
    return `${sign} ${absValue.toFixed(0)} 億`;
  }

  /**
   * 計算趨勢描述
   */
  calculateTrend(net) {
    if (net > 50) return '大幅買超';
    if (net > 10) return '買超';
    if (net > -10) return '中性';
    if (net > -50) return '賣超';
    return '大幅賣超';
  }

  /**
   * HTTP GET 請求
   */
  httpGet(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MarketDigest/1.0)'
        }
      };

      const req = protocol.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (err) {
            reject(new Error(`JSON 解析失敗: ${err.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('請求逾時'));
      });

      req.end();
    });
  }

  /**
   * 取得今天日期（YYYYMMDD）
   */
  getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 取得指定偏移天數的日期
   */
  getDateOffset(offset) {
    const now = new Date();
    now.setDate(now.getDate() + offset);
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 取得預設數據（API 失敗時使用）
   */
  getDefaultData() {
    return {
      hasData: false,
      foreign: {
        net: 0,
        netAmount: '買超 0 億',
        trend: '中性'
      },
      trust: {
        net: 0,
        netAmount: '買超 0 億',
        trend: '中性'
      },
      dealer: {
        net: 0,
        netAmount: '買超 0 億',
        trend: '中性'
      },
      total: {
        net: 0,
        netAmount: '買超 0 億'
      }
    };
  }

  /**
   * 延遲函數
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TWSEPlugin;
