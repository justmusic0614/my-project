/**
 * 統一 HTTP 客戶端
 * 目的：消除 news-fetcher.js, financial-data-fetcher.js, chip-data-fetcher.js 中的重複邏輯
 * 
 * 功能：
 * - 超時管理
 * - 自動重試（指數退避）
 * - 錯誤分類（網絡 vs HTTP）
 * - 結構化日誌
 * - RSS/JSON 特化方法
 */

const https = require('https');
const http = require('http');

class HttpClient {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000;
    this.retries = options.retries || 3;
    this.baseHeaders = options.headers || {
      'User-Agent': 'MarketDigest/1.0 (Node.js)'
    };
    this.logger = options.logger || console;
  }

  /**
   * 核心 fetch 方法（支援重試和超時）
   */
  async fetch(url, options = {}) {
    const mergedHeaders = { ...this.baseHeaders, ...options.headers };
    const timeout = options.timeout || this.timeout;
    const retries = options.retries !== undefined ? options.retries : this.retries;

    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.logger.info(`⏳ 重試 ${attempt}/${retries}，等待 ${backoff}ms...`);
          await this.sleep(backoff);
        }

        const response = await this._fetchWithTimeout(url, mergedHeaders, timeout);
        
        // HTTP 錯誤檢查
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.type = 'HTTP_ERROR';
          error.statusCode = response.status;
          throw error;
        }

        return response;
        
      } catch (error) {
        lastError = error;
        
        // 不重試的情況
        if (error.statusCode === 404 || error.statusCode === 403) {
          throw error;
        }
        
        // 最後一次嘗試
        if (attempt === retries) {
          this.logger.error(`❌ 請求失敗（已重試 ${retries} 次）: ${url}`, error.message);
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * 帶超時的底層 fetch
   */
  _fetchWithTimeout(url, headers, timeout) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const timer = setTimeout(() => {
        const error = new Error(`Request timeout after ${timeout}ms`);
        error.type = 'TIMEOUT';
        reject(error);
      }, timeout);

      protocol.get(url, { headers }, (res) => {
        clearTimeout(timer);
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            text: async () => data,
            json: async () => JSON.parse(data),
            headers: res.headers
          });
        });
      }).on('error', (err) => {
        clearTimeout(timer);
        err.type = 'NETWORK_ERROR';
        reject(err);
      });
    });
  }

  /**
   * JSON 專用方法
   */
  async fetchJSON(url, options = {}) {
    const response = await this.fetch(url, options);
    return await response.json();
  }

  /**
   * 文本專用方法
   */
  async fetchText(url, options = {}) {
    const response = await this.fetch(url, options);
    return await response.text();
  }

  /**
   * RSS 專用方法（保留向後相容）
   */
  async fetchRSS(url, options = {}) {
    return this.fetchText(url, options);
  }

  /**
   * 延遲工具
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 統計資訊（未來擴展）
   */
  getStats() {
    return {
      // 預留給未來的統計功能
    };
  }
}

// 單例模式（預設實例）
const defaultClient = new HttpClient();

module.exports = {
  HttpClient,
  default: defaultClient,
  // 便利方法
  fetchJSON: (url, options) => defaultClient.fetchJSON(url, options),
  fetchText: (url, options) => defaultClient.fetchText(url, options),
  fetchRSS: (url, options) => defaultClient.fetchRSS(url, options)
};
