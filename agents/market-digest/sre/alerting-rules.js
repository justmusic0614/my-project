/**
 * Alerting Rules - SRE 告警規則
 * 功能：
 * - 定義告警規則
 * - 檢查指標是否觸發告警
 * - 發送告警通知
 */

const { getMetrics } = require('./metrics-collector');

/**
 * 告警規則定義
 */
const ALERT_RULES = [
  {
    id: 'api_latency_high',
    name: 'API 延遲過高',
    severity: 'warning',
    threshold: 5000, // ms
    condition: (metrics) => {
      const avgLatency = parseFloat(metrics.http.averageLatency);
      return avgLatency > 5000;
    },
    message: (metrics) => `API 平均延遲 ${metrics.http.averageLatency}，超過閾值 5000ms`
  },
  {
    id: 'api_latency_critical',
    name: 'API 延遲嚴重',
    severity: 'critical',
    threshold: 10000, // ms
    condition: (metrics) => {
      const avgLatency = parseFloat(metrics.http.averageLatency);
      return avgLatency > 10000;
    },
    message: (metrics) => `API 平均延遲 ${metrics.http.averageLatency}，超過臨界值 10000ms`
  },
  {
    id: 'cache_hit_ratio_low',
    name: '快取命中率低',
    severity: 'warning',
    threshold: 50, // percent
    condition: (metrics) => {
      const hitRate = parseFloat(metrics.cache.hitRate);
      return hitRate < 50 && metrics.cache.totalRequests > 100;
    },
    message: (metrics) => `快取命中率 ${metrics.cache.hitRate}，低於閾值 50%`
  },
  {
    id: 'http_error_rate_high',
    name: 'HTTP 錯誤率高',
    severity: 'warning',
    threshold: 10, // percent
    condition: (metrics) => {
      const errorRate = 100 - parseFloat(metrics.http.successRate);
      return errorRate > 10 && metrics.http.totalRequests > 10;
    },
    message: (metrics) => `HTTP 錯誤率 ${(100 - parseFloat(metrics.http.successRate)).toFixed(2)}%，超過閾值 10%`
  },
  {
    id: 'http_error_rate_critical',
    name: 'HTTP 錯誤率嚴重',
    severity: 'critical',
    threshold: 50, // percent
    condition: (metrics) => {
      const errorRate = 100 - parseFloat(metrics.http.successRate);
      return errorRate > 50 && metrics.http.totalRequests > 10;
    },
    message: (metrics) => `HTTP 錯誤率 ${(100 - parseFloat(metrics.http.successRate)).toFixed(2)}%，超過臨界值 50%`
  }
];

/**
 * 告警檢查器
 */
class AlertChecker {
  constructor(options = {}) {
    this.rules = options.rules || ALERT_RULES;
    this.enabled = options.enabled !== false;
    this.onAlert = options.onAlert || this.defaultAlertHandler;
    this.alertHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * 檢查所有規則
   */
  checkAll() {
    if (!this.enabled) return [];

    const metrics = getMetrics();
    const summary = metrics.getSummary();
    const triggeredAlerts = [];

    for (const rule of this.rules) {
      try {
        if (rule.condition(summary)) {
          const alert = {
            id: rule.id,
            name: rule.name,
            severity: rule.severity,
            message: rule.message(summary),
            timestamp: new Date().toISOString(),
            metrics: summary
          };
          
          triggeredAlerts.push(alert);
          this.recordAlert(alert);
          this.onAlert(alert);
        }
      } catch (error) {
        console.error(`Error checking rule ${rule.id}:`, error.message);
      }
    }

    return triggeredAlerts;
  }

  /**
   * 記錄告警歷史
   */
  recordAlert(alert) {
    this.alertHistory.push(alert);
    
    // 限制歷史大小
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 獲取告警歷史
   */
  getHistory(limit = 10) {
    return this.alertHistory.slice(-limit).reverse();
  }

  /**
   * 獲取告警統計
   */
  getStats() {
    const stats = {
      total: this.alertHistory.length,
      bySeverity: {
        critical: 0,
        warning: 0,
        info: 0
      },
      byRule: {}
    };

    for (const alert of this.alertHistory) {
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      stats.byRule[alert.id] = (stats.byRule[alert.id] || 0) + 1;
    }

    return stats;
  }

  /**
   * 預設告警處理器
   */
  defaultAlertHandler(alert) {
    const icon = alert.severity === 'critical' ? '🚨' : '⚠️';
    console.error(`${icon} ALERT [${alert.severity.toUpperCase()}] ${alert.name}: ${alert.message}`);
  }

  /**
   * 清除歷史
   */
  clearHistory() {
    this.alertHistory = [];
  }
}

// 單例實例
let instance = null;

function getAlertChecker(options) {
  if (!instance) {
    instance = new AlertChecker(options);
  }
  return instance;
}

function resetAlertChecker() {
  instance = null;
}

module.exports = {
  ALERT_RULES,
  AlertChecker,
  getAlertChecker,
  resetAlertChecker
};
