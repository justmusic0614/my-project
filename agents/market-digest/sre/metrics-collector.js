/**
 * Metrics Collector - SRE 監控指標收集器
 * 功能：
 * - 收集 HTTP 請求指標（延遲、成功率）
 * - 收集快取命中率
 * - 收集資料處理效能
 * - 導出 Prometheus 格式指標
 */

const fs = require('fs');
const path = require('path');

class MetricsCollector {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.metricsPath = options.metricsPath || path.join(__dirname, '../logs/metrics.json');
    
    // 指標儲存
    this.metrics = {
      http: {
        requests: [],
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        totalRequests: 0
      },
      dataProcessing: {
        operations: [],
        totalOperations: 0
      },
      system: {
        startTime: Date.now(),
        lastUpdateTime: Date.now()
      }
    };
    
    // 定期保存指標
    if (this.enabled) {
      this.saveInterval = setInterval(() => this.save(), 60000); // 每分鐘保存
    }
  }

  /**
   * 記錄 HTTP 請求
   */
  recordHttpRequest(url, duration, statusCode, error = null) {
    if (!this.enabled) return;

    const record = {
      timestamp: Date.now(),
      url: this.sanitizeUrl(url),
      duration,
      statusCode,
      success: statusCode >= 200 && statusCode < 400,
      error: error ? error.message : null
    };

    this.metrics.http.requests.push(record);
    this.metrics.http.totalRequests++;
    
    if (record.success) {
      this.metrics.http.successRequests++;
    } else {
      this.metrics.http.failedRequests++;
    }

    // 只保留最近 1000 筆記錄
    if (this.metrics.http.requests.length > 1000) {
      this.metrics.http.requests = this.metrics.http.requests.slice(-1000);
    }

    this.metrics.system.lastUpdateTime = Date.now();
  }

  /**
   * 記錄快取命中
   */
  recordCacheHit(key, isHit) {
    if (!this.enabled) return;

    this.metrics.cache.totalRequests++;
    if (isHit) {
      this.metrics.cache.hits++;
    } else {
      this.metrics.cache.misses++;
    }

    this.metrics.system.lastUpdateTime = Date.now();
  }

  /**
   * 記錄資料處理
   */
  recordDataProcessing(type, count, duration) {
    if (!this.enabled) return;

    const record = {
      timestamp: Date.now(),
      type,
      count,
      duration,
      throughput: count / (duration / 1000) // items per second
    };

    this.metrics.dataProcessing.operations.push(record);
    this.metrics.dataProcessing.totalOperations++;

    // 只保留最近 500 筆記錄
    if (this.metrics.dataProcessing.operations.length > 500) {
      this.metrics.dataProcessing.operations = this.metrics.dataProcessing.operations.slice(-500);
    }

    this.metrics.system.lastUpdateTime = Date.now();
  }

  /**
   * 計算 HTTP 平均延遲
   */
  getAverageHttpLatency(timeWindowMs = 300000) { // 預設 5 分鐘
    const cutoff = Date.now() - timeWindowMs;
    const recentRequests = this.metrics.http.requests.filter(r => r.timestamp > cutoff);
    
    if (recentRequests.length === 0) return 0;
    
    const total = recentRequests.reduce((sum, r) => sum + r.duration, 0);
    return total / recentRequests.length;
  }

  /**
   * 計算快取命中率（返回 0-1 比例）
   */
  getCacheHitRate() {
    if (this.metrics.cache.totalRequests === 0) return 0;
    return this.metrics.cache.hits / this.metrics.cache.totalRequests;
  }

  /**
   * 計算 HTTP 成功率（返回 0-1 比例）
   */
  getHttpSuccessRate() {
    if (this.metrics.http.totalRequests === 0) return 1;
    return this.metrics.http.successRequests / this.metrics.http.totalRequests;
  }

  /**
   * 獲取統計摘要
   */
  getSummary() {
    return {
      http: {
        totalRequests: this.metrics.http.totalRequests,
        successRequests: this.metrics.http.successRequests,
        failedRequests: this.metrics.http.failedRequests,
        successRate: (this.getHttpSuccessRate() * 100).toFixed(2) + '%',
        averageLatency: this.getAverageHttpLatency().toFixed(0) + 'ms'
      },
      cache: {
        hits: this.metrics.cache.hits,
        misses: this.metrics.cache.misses,
        totalRequests: this.metrics.cache.totalRequests,
        hitRate: (this.getCacheHitRate() * 100).toFixed(2) + '%'
      },
      dataProcessing: {
        totalOperations: this.metrics.dataProcessing.totalOperations
      },
      system: {
        uptime: this.getUptime(),
        lastUpdate: new Date(this.metrics.system.lastUpdateTime).toISOString()
      }
    };
  }

  /**
   * 計算運行時間
   */
  getUptime() {
    const ms = Date.now() - this.metrics.system.startTime;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * 導出為 Prometheus 格式
   */
  exportPrometheus() {
    const lines = [];
    
    // HTTP 指標
    lines.push('# HELP http_requests_total Total number of HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    lines.push(`http_requests_total ${this.metrics.http.totalRequests}`);
    
    lines.push('# HELP http_requests_success Number of successful HTTP requests');
    lines.push('# TYPE http_requests_success counter');
    lines.push(`http_requests_success ${this.metrics.http.successRequests}`);
    
    lines.push('# HELP http_request_duration_ms Average HTTP request duration');
    lines.push('# TYPE http_request_duration_ms gauge');
    lines.push(`http_request_duration_ms ${this.getAverageHttpLatency()}`);
    
    // 快取指標
    lines.push('# HELP cache_hits_total Total number of cache hits');
    lines.push('# TYPE cache_hits_total counter');
    lines.push(`cache_hits_total ${this.metrics.cache.hits}`);
    
    lines.push('# HELP cache_misses_total Total number of cache misses');
    lines.push('# TYPE cache_misses_total counter');
    lines.push(`cache_misses_total ${this.metrics.cache.misses}`);
    
    lines.push('# HELP cache_hit_rate_percent Cache hit rate percentage');
    lines.push('# TYPE cache_hit_rate_percent gauge');
    lines.push(`cache_hit_rate_percent ${(this.getCacheHitRate() * 100).toFixed(2)}`);
    
    // 系統指標
    lines.push('# HELP system_uptime_seconds System uptime in seconds');
    lines.push('# TYPE system_uptime_seconds gauge');
    lines.push(`system_uptime_seconds ${(Date.now() - this.metrics.system.startTime) / 1000}`);
    
    return lines.join('\n');
  }

  /**
   * 保存指標到檔案
   */
  async save() {
    if (!this.enabled) return;

    try {
      const dir = path.dirname(this.metricsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        savedAt: new Date().toISOString(),
        summary: this.getSummary(),
        metrics: this.metrics
      };

      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save metrics:', error.message);
    }
  }

  /**
   * 重置指標
   */
  reset() {
    this.metrics.http.requests = [];
    this.metrics.http.totalRequests = 0;
    this.metrics.http.successRequests = 0;
    this.metrics.http.failedRequests = 0;
    this.metrics.cache.hits = 0;
    this.metrics.cache.misses = 0;
    this.metrics.cache.totalRequests = 0;
    this.metrics.dataProcessing.operations = [];
    this.metrics.dataProcessing.totalOperations = 0;
    this.metrics.system.startTime = Date.now();
    this.metrics.system.lastUpdateTime = Date.now();
  }

  /**
   * 清理資源
   */
  destroy() {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    this.save();
  }

  /**
   * 清理 URL（移除敏感資訊）
   */
  sanitizeUrl(url) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch (e) {
      return url;
    }
  }
}

// 單例實例
let instance = null;

function getMetrics(options) {
  if (!instance) {
    instance = new MetricsCollector(options);
  }
  return instance;
}

function resetMetrics() {
  instance = null;
}

module.exports = {
  MetricsCollector,
  getMetrics,
  resetMetrics
};
