// SRE Circuit Breaker Pattern
// 防止級聯失敗，自動降級保護系統

const fs = require('fs');
const path = require('path');

/**
 * Circuit Breaker 狀態
 */
const STATES = {
  CLOSED: 'CLOSED',       // 正常運作
  OPEN: 'OPEN',           // 熔斷開啟（拒絕請求）
  HALF_OPEN: 'HALF_OPEN'  // 半開（測試恢復）
};

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    
    // 配置
    this.failureThreshold = options.failureThreshold || 5;      // 失敗次數門檻
    this.successThreshold = options.successThreshold || 2;      // 成功次數門檻（恢復）
    this.timeout = options.timeout || 60000;                    // 熔斷持續時間（毫秒）
    this.resetTimeout = options.resetTimeout || 30000;          // 半開重試時間
    this.monitoringPeriod = options.monitoringPeriod || 120000; // 監控週期
    
    // 狀態
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    
    // 統計
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      totalRejections: 0,
      stateChanges: []
    };
    
    // 日誌
    this.logDir = options.logDir || path.join(__dirname, '../logs');
    this.ensureLogDir();
  }

  /**
   * 執行受保護的函數
   */
  async execute(fn, fallback = null) {
    this.stats.totalRequests++;
    
    // 檢查熔斷器狀態
    if (this.state === STATES.OPEN) {
      // 檢查是否可以嘗試恢復
      if (Date.now() < this.nextAttemptTime) {
        this.stats.totalRejections++;
        console.log(`🚫 [${this.name}] Circuit OPEN - 請求被拒絕`);
        
        if (fallback) {
          console.log(`🔄 [${this.name}] 使用 fallback 機制`);
          return await fallback();
        }
        
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }
      
      // 進入 HALF_OPEN 狀態
      this.changeState(STATES.HALF_OPEN);
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      
      // 如果有 fallback，使用它
      if (fallback) {
        console.log(`🔄 [${this.name}] 使用 fallback 機制`);
        return await fallback();
      }
      
      throw err;
    }
  }

  /**
   * 成功回調
   */
  onSuccess() {
    this.failureCount = 0;
    this.stats.totalSuccesses++;
    
    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.successThreshold) {
        this.changeState(STATES.CLOSED);
        this.successCount = 0;
      }
    }
  }

  /**
   * 失敗回調
   */
  onFailure(err) {
    this.failureCount++;
    this.stats.totalFailures++;
    this.lastFailureTime = Date.now();
    
    console.error(`❌ [${this.name}] 失敗 (${this.failureCount}/${this.failureThreshold}): ${err.message}`);
    
    if (this.state === STATES.HALF_OPEN) {
      // HALF_OPEN 時失敗 → 立即回到 OPEN
      this.changeState(STATES.OPEN);
    } else if (this.failureCount >= this.failureThreshold) {
      // 達到失敗門檻 → 熔斷
      this.changeState(STATES.OPEN);
    }
  }

  /**
   * 改變狀態
   */
  changeState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    const change = {
      timestamp: new Date().toISOString(),
      from: oldState,
      to: newState,
      failureCount: this.failureCount,
      totalFailures: this.stats.totalFailures
    };
    
    this.stats.stateChanges.push(change);
    
    console.log(`🔄 [${this.name}] State: ${oldState} → ${newState}`);
    
    // 記錄到日誌
    this.logStateChange(change);
    
    // 設定下次嘗試時間
    if (newState === STATES.OPEN) {
      this.nextAttemptTime = Date.now() + this.timeout;
      console.log(`⏰ [${this.name}] 將在 ${this.timeout}ms 後嘗試恢復`);
    } else if (newState === STATES.CLOSED) {
      this.failureCount = 0;
      this.nextAttemptTime = null;
      console.log(`✅ [${this.name}] 熔斷器已恢復正常`);
    }
  }

  /**
   * 強制重置
   */
  reset() {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    console.log(`🔄 [${this.name}] 熔斷器已重置`);
  }

  /**
   * 取得狀態報告
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptTime: this.nextAttemptTime,
      stats: {
        ...this.stats,
        failureRate: this.stats.totalRequests > 0 
          ? (this.stats.totalFailures / this.stats.totalRequests * 100).toFixed(2) + '%'
          : '0%',
        rejectionRate: this.stats.totalRequests > 0
          ? (this.stats.totalRejections / this.stats.totalRequests * 100).toFixed(2) + '%'
          : '0%'
      }
    };
  }

  /**
   * 記錄狀態變更
   */
  logStateChange(change) {
    const logFile = path.join(this.logDir, `circuit-breaker-${this.name}.log`);
    const entry = `${change.timestamp} | ${change.from} → ${change.to} | Failures: ${change.failureCount}\n`;
    
    try {
      fs.appendFileSync(logFile, entry, 'utf8');
    } catch (err) {
      console.error(`⚠️  無法寫入熔斷器日誌: ${err.message}`);
    }
  }

  /**
   * 確保日誌目錄存在
   */
  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
}

/**
 * Circuit Breaker Manager - 管理多個熔斷器
 */
class CircuitBreakerManager {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * 註冊熔斷器
   */
  register(name, options = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(name, options));
    }
    return this.breakers.get(name);
  }

  /**
   * 取得熔斷器
   */
  get(name) {
    return this.breakers.get(name);
  }

  /**
   * 執行受保護的函數
   */
  async execute(name, fn, fallback = null) {
    const breaker = this.breakers.get(name);
    if (!breaker) {
      throw new Error(`Circuit breaker '${name}' not found`);
    }
    return await breaker.execute(fn, fallback);
  }

  /**
   * 取得所有熔斷器狀態
   */
  getStatus() {
    const status = {};
    for (const [name, breaker] of this.breakers.entries()) {
      status[name] = breaker.getStatus();
    }
    return status;
  }

  /**
   * 重置所有熔斷器
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// 單例模式
let managerInstance = null;

function getManager() {
  if (!managerInstance) {
    managerInstance = new CircuitBreakerManager();
  }
  return managerInstance;
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerManager,
  getManager,
  STATES
};
