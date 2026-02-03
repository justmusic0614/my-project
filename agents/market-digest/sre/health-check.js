// SRE Health Check System
// 定期檢查系統各組件健康狀態

const fs = require('fs');
const path = require('path');
const { getManager: getCircuitBreakerManager } = require('./circuit-breaker');
const { getInstance: getGracefulDegradation } = require('./graceful-degradation');

class HealthCheckSystem {
  constructor(options = {}) {
    this.checks = new Map();
    this.lastResults = new Map();
    this.healthHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * 註冊健康檢查
   */
  register(name, checkFn, options = {}) {
    this.checks.set(name, {
      name,
      checkFn,
      critical: options.critical !== false, // 預設為 critical
      timeout: options.timeout || 5000,
      interval: options.interval || 60000 // 預設每分鐘檢查
    });
  }

  /**
   * 執行單個健康檢查
   */
  async runCheck(name) {
    const check = this.checks.get(name);
    if (!check) {
      throw new Error(`Health check '${name}' not found`);
    }

    const startTime = Date.now();
    
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
      );
      
      const checkPromise = check.checkFn();
      const result = await Promise.race([checkPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      
      const checkResult = {
        name,
        status: 'HEALTHY',
        critical: check.critical,
        timestamp: new Date().toISOString(),
        duration,
        details: result || {}
      };
      
      this.lastResults.set(name, checkResult);
      return checkResult;
    } catch (err) {
      const duration = Date.now() - startTime;
      
      const checkResult = {
        name,
        status: 'UNHEALTHY',
        critical: check.critical,
        timestamp: new Date().toISOString(),
        duration,
        error: err.message,
        details: {}
      };
      
      this.lastResults.set(name, checkResult);
      return checkResult;
    }
  }

  /**
   * 執行所有健康檢查
   */
  async runAll() {
    console.log('🏥 執行健康檢查...\n');
    
    const results = [];
    for (const name of this.checks.keys()) {
      const result = await this.runCheck(name);
      results.push(result);
    }
    
    // 計算整體健康狀態
    const overallStatus = this.calculateOverallStatus(results);
    
    // 記錄到歷史
    this.recordHistory(overallStatus);
    
    // 顯示報告
    this.displayReport(results, overallStatus);
    
    return overallStatus;
  }

  /**
   * 計算整體健康狀態
   */
  calculateOverallStatus(results) {
    const healthy = results.filter(r => r.status === 'HEALTHY').length;
    const unhealthy = results.filter(r => r.status === 'UNHEALTHY').length;
    const criticalUnhealthy = results.filter(r => r.status === 'UNHEALTHY' && r.critical).length;
    
    let status = 'HEALTHY';
    if (criticalUnhealthy > 0) {
      status = 'CRITICAL';
    } else if (unhealthy > 0) {
      status = 'DEGRADED';
    }
    
    return {
      status,
      timestamp: new Date().toISOString(),
      checks: {
        total: results.length,
        healthy,
        unhealthy,
        criticalUnhealthy
      },
      results
    };
  }

  /**
   * 記錄歷史
   */
  recordHistory(overallStatus) {
    this.healthHistory.push(overallStatus);
    
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
  }

  /**
   * 顯示報告
   */
  displayReport(results, overallStatus) {
    console.log('='.repeat(60));
    console.log('🏥 Health Check Report');
    console.log('='.repeat(60));
    console.log(`Overall Status: ${this.getStatusEmoji(overallStatus.status)} ${overallStatus.status}`);
    console.log(`Timestamp: ${overallStatus.timestamp}`);
    console.log('');
    
    // 顯示各項檢查
    for (const result of results) {
      const emoji = result.status === 'HEALTHY' ? '✅' : '❌';
      const criticalLabel = result.critical ? '[CRITICAL]' : '[OPTIONAL]';
      console.log(`${emoji} ${criticalLabel} ${result.name}`);
      console.log(`   Status: ${result.status}`);
      console.log(`   Duration: ${result.duration}ms`);
      
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
      
      if (Object.keys(result.details).length > 0) {
        console.log(`   Details:`, JSON.stringify(result.details, null, 2).split('\n').map((l, i) => i === 0 ? l : `            ${l}`).join('\n'));
      }
      console.log('');
    }
    
    console.log('='.repeat(60));
    console.log(`Summary: ${overallStatus.checks.healthy}/${overallStatus.checks.total} checks passed`);
    
    if (overallStatus.checks.criticalUnhealthy > 0) {
      console.log(`⚠️  ${overallStatus.checks.criticalUnhealthy} CRITICAL checks failed!`);
    }
    
    console.log('='.repeat(60) + '\n');
  }

  /**
   * 取得狀態 emoji
   */
  getStatusEmoji(status) {
    const map = {
      'HEALTHY': '🟢',
      'DEGRADED': '🟡',
      'CRITICAL': '🔴'
    };
    return map[status] || '⚪';
  }

  /**
   * 取得最近的健康狀態
   */
  getRecentHistory(count = 10) {
    return this.healthHistory.slice(-count);
  }

  /**
   * 取得當前狀態
   */
  getCurrentStatus() {
    if (this.healthHistory.length === 0) {
      return null;
    }
    return this.healthHistory[this.healthHistory.length - 1];
  }
}

/**
 * 預設健康檢查項目
 */
function registerDefaultChecks(healthCheck) {
  // 1. 檢查設定檔
  healthCheck.register('config', async () => {
    const configPath = path.join(__dirname, '../config.json');
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    
    return {
      size: content.length,
      dataSources: Object.keys(config.data_sources || {}).length
    };
  }, { critical: true, timeout: 1000 });

  // 2. 檢查快取目錄
  healthCheck.register('cache-dir', async () => {
    const cacheDir = path.join(__dirname, '../data/cache');
    const files = fs.readdirSync(cacheDir);
    const newsCache = path.join(cacheDir, 'news-raw.json');
    
    let cacheSize = 0;
    if (fs.existsSync(newsCache)) {
      const stat = fs.statSync(newsCache);
      cacheSize = stat.size;
    }
    
    return {
      files: files.length,
      cacheSize: `${(cacheSize / 1024).toFixed(2)} KB`
    };
  }, { critical: true, timeout: 2000 });

  // 3. 檢查日誌目錄
  healthCheck.register('logs-dir', async () => {
    const logsDir = path.join(__dirname, '../logs');
    const files = fs.readdirSync(logsDir);
    
    return {
      files: files.length
    };
  }, { critical: false, timeout: 1000 });

  // 4. 檢查 Circuit Breakers
  healthCheck.register('circuit-breakers', async () => {
    const manager = getCircuitBreakerManager();
    const status = manager.getStatus();
    
    const open = Object.values(status).filter(s => s.state === 'OPEN').length;
    const halfOpen = Object.values(status).filter(s => s.state === 'HALF_OPEN').length;
    
    if (open > 0) {
      throw new Error(`${open} circuit breaker(s) in OPEN state`);
    }
    
    return {
      total: Object.keys(status).length,
      open,
      halfOpen
    };
  }, { critical: false, timeout: 1000 });

  // 5. 檢查降級狀態
  healthCheck.register('degradation', async () => {
    const degradation = getGracefulDegradation();
    const status = degradation.getStatus();
    
    if (status.degradationMode) {
      throw new Error(`System in degradation mode: ${status.activeStrategies.join(', ')}`);
    }
    
    return {
      degradationMode: status.degradationMode,
      activeStrategies: status.activeStrategies.length
    };
  }, { critical: false, timeout: 1000 });

  // 6. 檢查記憶體使用
  healthCheck.register('memory', async () => {
    const usage = process.memoryUsage();
    const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (usage.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (usage.rss / 1024 / 1024).toFixed(2);
    
    // 警告：heap 使用超過 500MB
    if (usage.heapUsed > 500 * 1024 * 1024) {
      throw new Error(`High memory usage: ${heapUsedMB} MB`);
    }
    
    return {
      heapUsed: `${heapUsedMB} MB`,
      heapTotal: `${heapTotalMB} MB`,
      rss: `${rssMB} MB`
    };
  }, { critical: false, timeout: 1000 });

  // 7. 檢查執行時間
  healthCheck.register('uptime', async () => {
    const uptimeSeconds = process.uptime();
    const uptimeMinutes = (uptimeSeconds / 60).toFixed(2);
    
    return {
      uptime: `${uptimeMinutes} minutes`,
      pid: process.pid
    };
  }, { critical: false, timeout: 500 });
}

// 建立實例
function createHealthCheckSystem() {
  const healthCheck = new HealthCheckSystem();
  registerDefaultChecks(healthCheck);
  return healthCheck;
}

module.exports = {
  HealthCheckSystem,
  registerDefaultChecks,
  createHealthCheckSystem
};
