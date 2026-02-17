/**
 * Rate Limiter — Token Bucket 算法
 * 為每個外部 API 提供獨立的限流器
 *
 * 使用方式：
 *   const rateLimiter = require('./shared/rate-limiter');
 *   await rateLimiter.acquire('perplexity');  // 等待令牌可用
 */

class TokenBucket {
  constructor(name, options = {}) {
    this.name = name;
    this.reqPerMin = options.reqPerMin || 10;
    this.maxTokens = options.maxTokens || this.reqPerMin;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.refillIntervalMs = 60000 / this.reqPerMin; // 每次補充一個令牌的間隔
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
      reqPerMin: this.reqPerMin
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
   * @param {string} name - API 名稱（perplexity / fmp / finmind）
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
   * 用於單元測試
   */
  async test() {
    console.log('🧪 Rate Limiter test...');
    this.register('test-api', { reqPerMin: 60 });

    const start = Date.now();
    await this.acquire('test-api');
    await this.acquire('test-api');
    const elapsed = Date.now() - start;

    console.log(`✅ Acquired 2 tokens in ${elapsed}ms (expected < 100ms)`);
    console.log('Status:', JSON.stringify(this.getStatus(), null, 2));
  }
}

// 單例，全域共用
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;
module.exports.RateLimiter = RateLimiter;
module.exports.TokenBucket = TokenBucket;
