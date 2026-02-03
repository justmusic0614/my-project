// IDEMPOTENCY v0 - In-memory cache
class IdempotencyCache {
  constructor() {
    this.cache = new Map();
    this.ttl = 30 * 60 * 1000; // 30 minutes
  }

  getKey(date, materialCount, lastItemTs) {
    return `${date}_${materialCount}_${lastItemTs}`;
  }

  get(date, materialCount, lastItemTs) {
    const key = this.getKey(date, materialCount, lastItemTs);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // 检查 TTL
    const now = Date.now();
    if (now - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    console.log(`✅ 命中缓存，重用上次报告`);
    return cached.report;
  }

  set(date, materialCount, lastItemTs, report) {
    const key = this.getKey(date, materialCount, lastItemTs);
    this.cache.set(key, {
      report: report,
      timestamp: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }
}

// 单例
const cache = new IdempotencyCache();

module.exports = cache;
