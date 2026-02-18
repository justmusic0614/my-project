/**
 * Rate Limiter — Token Bucket 算法
 * 為每個外部 API 提供獨立的限流器
 *
 * 支援兩種限速模式：
 *   - reqPerMin: 每分鐘請求數（perplexity/fmp/finmind）
 *   - intervalMs: 固定間隔毫秒數（SEC EDGAR: 100ms = 10 req/sec）
 *
 * 使用方式：
 *   const rateLimiter = require('./shared/rate-limiter');
 *   await rateLimiter.acquire('perplexity');   // 每分鐘 5 次
 *   await rateLimiter.acquire('secEdgar');      // 每 100ms 1 次
 */

class TokenBucket {
  constructor(name, options = {}) {
    this.name = name;

    // 支援 intervalMs（sec-level）或 reqPerMin（min-level）
    if (options.intervalMs) {
      // SEC EDGAR: intervalMs: 100 → 10 req/sec
      this.refillIntervalMs = options.intervalMs;
      this.reqPerMin = Math.round(60000 / options.intervalMs);
    } else {
      this.reqPerMin = options.reqPerMin || 10;
      this.refillIntervalMs = 60000 / this.reqPerMin;
    }

    this.maxTokens = options.maxTokens || Math.max(1, Math.min(this.reqPerMin, 10));
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  /**
   * 補充令牌（基於流逝時間）
   */
  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now - (elapsed % this.refillIntervalMs);
    }
  }

  /**
   * 取得一個令牌（阻塞直到可用）
   * @returns {Promise<void>}
   */
  async acquire() {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // 計算等待時間（直到下一個令牌可用）
    const waitMs = this.refillIntervalMs - (Date.now() - this.lastRefill);
    await sleep(Math.max(waitMs, 100));
    return this.acquire(); // 遞迴重試
  }

  getStatus() {
    this.refill();
    return {
      name: this.name,
      tokens: Math.floor(this.tokens),
      maxTokens: this.maxTokens,
      reqPerMin: this.reqPerMin,
      refillIntervalMs: Math.round(this.refillIntervalMs)
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * RateLimiter — 管理多個 API 的限流器
 */
class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  /**
   * 從 config 初始化
   * @param {object} rateLimitsConfig - config.json 的 rateLimits 區塊
   */
  init(rateLimitsConfig = {}) {
    for (const [name, opts] of Object.entries(rateLimitsConfig)) {
      this.register(name, opts);
    }
    return this;
  }

  /**
   * 註冊一個 API 的限流器
   */
  register(name, options = {}) {
    if (!this.buckets.has(name)) {
      this.buckets.set(name, new TokenBucket(name, options));
    }
    return this;
  }

  /**
   * 等待並取得一個令牌
   * @param {string} name - API 名稱（perplexity / fmp / finmind / secEdgar / twse / yahoo）
   */
  async acquire(name) {
    if (!this.buckets.has(name)) {
      // 未設定的 API 預設 10 req/min
      this.register(name, { reqPerMin: 10 });
    }
    return this.buckets.get(name).acquire();
  }

  /**
   * 取得所有限流器的狀態
   */
  getStatus() {
    const result = {};
    for (const [name, bucket] of this.buckets) {
      result[name] = bucket.getStatus();
    }
    return result;
  }

  /**
   * 批次等待：同時對同一 API 發出多個請求時，依序等待
   * @param {string} name - API 名稱
   * @param {number} count - 需要的令牌數
   */
  async acquireN(name, count) {
    for (let i = 0; i < count; i++) {
      await this.acquire(name);
    }
  }
}

// 單例，全域共用
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;
module.exports.RateLimiter = RateLimiter;
module.exports.TokenBucket = TokenBucket;
