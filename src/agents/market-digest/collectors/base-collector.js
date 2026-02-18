/**
 * BaseCollector — 收集器基礎類
 * 所有 collector 繼承此類，獲得統一的：
 *   - Circuit Breaker 整合
 *   - Retry + Exponential Backoff
 *   - Cache 封裝
 *   - Rate Limiter 整合
 *   - 結構化日誌
 *   - 標準化輸出工具函數
 */

'use strict';

const path = require('path');
const { getManager } = require('../sre/circuit-breaker');
const rateLimiter = require('../shared/rate-limiter');
const CacheManager = require('../shared/cache-manager');
const { createLogger } = require('../shared/logger');
const costLedger = require('../shared/cost-ledger');
const { DEGRADATION_LABELS } = require('../shared/schemas/daily-brief.schema');

const CACHE_BASE_DIR = path.join(__dirname, '../data/cache/collectors');

class BaseCollector {
  /**
   * @param {string} name - 收集器名稱（對應 rateLimiter / circuitBreaker key）
   * @param {object} config - 從 config.json 傳入的配置
   */
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.logger = createLogger(`collector:${name}`);
    this.cache = new CacheManager(path.join(CACHE_BASE_DIR, name));
    this.rateLimiter = rateLimiter;
    this.costLedger = costLedger;

    // Circuit Breaker
    const cbManager = getManager();
    this.circuitBreaker = cbManager.register(name, {
      failureThreshold: config.cbFailureThreshold || 5,
      timeout: config.cbTimeout || 60000,
      successThreshold: 2
    });
  }

  /**
   * 主收集方法 — 子類必須覆寫
   * @returns {Promise<object>} 標準化的收集結果
   */
  async collect() {
    throw new Error(`${this.name}.collect() must be implemented`);
  }

  /**
   * 帶重試的執行（整合 Circuit Breaker）
   * @param {Function} fn - 要執行的非同步函數
   * @param {number} [maxRetries=3]
   * @param {*} [fallback=null] - Circuit 開路時的降級值
   */
  async withRetry(fn, maxRetries = 3, fallback = null) {
    return await this.circuitBreaker.execute(async () => {
      let lastErr;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await fn();
        } catch (err) {
          lastErr = err;
          if (i < maxRetries - 1) {
            const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
            this.logger.warn(`retry ${i + 1}/${maxRetries - 1}, waiting ${delay}ms`, { error: err.message });
            await this.sleep(delay);
          }
        }
      }
      throw lastErr;
    }, fallback);
  }

  /**
   * 帶快取的執行
   * @param {string} key - 快取鍵
   * @param {number} ttl - TTL（ms）
   * @param {Function} fn - miss 時執行的非同步函數
   */
  async withCache(key, ttl, fn) {
    const cached = this.cache.get(key, ttl);
    if (cached) {
      this.logger.debug(`cache hit: ${key}`);
      return { ...cached, _fromCache: true };
    }
    const result = await fn();
    if (result) this.cache.set(key, result, ttl);
    return result;
  }

  /**
   * 建立標準化市場數據點（MarketDataPoint schema）
   * @param {number} value
   * @param {{ change?, changePct?, source?, verified? }} opts
   */
  makeDataPoint(value, opts = {}) {
    if (value == null || isNaN(value)) {
      return { value: null, degraded: 'NA', source: opts.source || this.name, fetchedAt: new Date().toISOString() };
    }
    return {
      value: parseFloat(value),
      change:    opts.change    != null ? parseFloat(opts.change) : undefined,
      changePct: opts.changePct != null ? parseFloat(opts.changePct) : undefined,
      source:    opts.source || this.name,
      fetchedAt: new Date().toISOString(),
      verified:  opts.verified || false,
      degraded:  opts.degraded || ''
    };
  }

  /**
   * 建立帶 [DELAYED] 降級標記的數據點（使用快取值時）
   */
  makeDelayedDataPoint(value, opts = {}) {
    return this.makeDataPoint(value, { ...opts, degraded: 'DELAYED' });
  }

  /**
   * 建立標準化新聞條目（NewsItem schema）
   */
  makeNewsItem(opts = {}) {
    return {
      id:          opts.id || `${this.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title:       opts.title || '',
      summary:     opts.summary || '',
      source:      opts.source || this.name,
      url:         opts.url || '',
      publishedAt: opts.publishedAt || new Date().toISOString(),
      importance:  opts.importance || 'P2',
      category:    opts.category || 'General',
      keywords:    opts.keywords || [],
      isDuplicate: false
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStatus() {
    return {
      name: this.name,
      circuitBreaker: this.circuitBreaker.getStatus?.() || 'unknown',
      rateLimiter: this.rateLimiter.getStatus?.[this.name] || null
    };
  }
}

module.exports = BaseCollector;
