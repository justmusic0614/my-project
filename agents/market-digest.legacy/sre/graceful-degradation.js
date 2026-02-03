// SRE Graceful Degradation
// 當主要功能失敗時，提供降級服務

const fs = require('fs');
const path = require('path');

/**
 * 降級策略
 */
const STRATEGIES = {
  USE_CACHE: 'USE_CACHE',           // 使用快取
  USE_FALLBACK: 'USE_FALLBACK',     // 使用後備數據
  SKIP_OPTIONAL: 'SKIP_OPTIONAL',   // 跳過非必要功能
  SIMPLIFIED: 'SIMPLIFIED'          // 簡化輸出
};

class GracefulDegradation {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(__dirname, '../data/cache');
    this.maxCacheAge = options.maxCacheAge || 86400000; // 24 小時
    
    // 降級狀態
    this.degradationMode = false;
    this.activeStrategies = new Set();
    this.degradationLog = [];
  }

  /**
   * 進入降級模式
   */
  enterDegradationMode(reason, strategy) {
    this.degradationMode = true;
    this.activeStrategies.add(strategy);
    
    const entry = {
      timestamp: new Date().toISOString(),
      reason,
      strategy,
      action: 'ENTER'
    };
    
    this.degradationLog.push(entry);
    console.log(`⚠️  進入降級模式: ${reason} | 策略: ${strategy}`);
  }

  /**
   * 離開降級模式
   */
  exitDegradationMode(strategy) {
    this.activeStrategies.delete(strategy);
    
    if (this.activeStrategies.size === 0) {
      this.degradationMode = false;
    }
    
    const entry = {
      timestamp: new Date().toISOString(),
      strategy,
      action: 'EXIT'
    };
    
    this.degradationLog.push(entry);
    console.log(`✅ 離開降級模式: ${strategy}`);
  }

  /**
   * 策略 1: 使用快取資料
   */
  async useCachedData(cacheKey, fetcher, options = {}) {
    const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
    const maxAge = options.maxAge || this.maxCacheAge;
    
    try {
      // 嘗試從主要來源取得
      const data = await fetcher();
      
      // 成功：更新快取
      this.saveCache(cacheFile, data);
      
      return {
        data,
        source: 'PRIMARY',
        cached: false
      };
    } catch (err) {
      console.error(`❌ 主要來源失敗: ${err.message}`);
      this.enterDegradationMode(`Primary source failed: ${err.message}`, STRATEGIES.USE_CACHE);
      
      // 嘗試使用快取
      if (fs.existsSync(cacheFile)) {
        const cached = this.loadCache(cacheFile);
        
        if (cached) {
          const age = Date.now() - cached.timestamp;
          
          if (age < maxAge) {
            console.log(`🔄 使用快取資料（${(age / 1000 / 60).toFixed(0)} 分鐘前）`);
            return {
              data: cached.data,
              source: 'CACHE',
              cached: true,
              age
            };
          } else {
            console.log(`⚠️  快取已過期（${(age / 1000 / 3600).toFixed(1)} 小時前）`);
          }
        }
      }
      
      // 快取不可用，拋出錯誤
      throw new Error(`Primary source failed and no valid cache available`);
    }
  }

  /**
   * 策略 2: 使用後備數據
   */
  async useFallbackData(primaryFetcher, fallbackData, reason = 'Primary failed') {
    try {
      const data = await primaryFetcher();
      return {
        data,
        source: 'PRIMARY',
        degraded: false
      };
    } catch (err) {
      console.error(`❌ ${reason}: ${err.message}`);
      this.enterDegradationMode(reason, STRATEGIES.USE_FALLBACK);
      
      console.log(`🔄 使用後備數據`);
      return {
        data: fallbackData,
        source: 'FALLBACK',
        degraded: true
      };
    }
  }

  /**
   * 策略 3: 跳過非必要功能
   */
  skipOptionalFeature(featureName, fn, defaultValue = null) {
    try {
      return fn();
    } catch (err) {
      console.warn(`⚠️  跳過非必要功能: ${featureName} (${err.message})`);
      this.enterDegradationMode(`Optional feature failed: ${featureName}`, STRATEGIES.SKIP_OPTIONAL);
      return defaultValue;
    }
  }

  /**
   * 策略 4: 簡化輸出
   */
  simplifyOutput(data, essentialFields) {
    console.log(`🔄 簡化輸出（僅保留核心欄位）`);
    this.enterDegradationMode('Simplifying output', STRATEGIES.SIMPLIFIED);
    
    const simplified = {};
    for (const field of essentialFields) {
      if (data.hasOwnProperty(field)) {
        simplified[field] = data[field];
      }
    }
    
    return simplified;
  }

  /**
   * 儲存快取
   */
  saveCache(file, data) {
    try {
      const cached = {
        timestamp: Date.now(),
        data
      };
      fs.writeFileSync(file, JSON.stringify(cached, null, 2), 'utf8');
    } catch (err) {
      console.error(`⚠️  無法儲存快取: ${err.message}`);
    }
  }

  /**
   * 讀取快取
   */
  loadCache(file) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error(`⚠️  無法讀取快取: ${err.message}`);
      return null;
    }
  }

  /**
   * 取得降級狀態
   */
  getStatus() {
    return {
      degradationMode: this.degradationMode,
      activeStrategies: Array.from(this.activeStrategies),
      degradationLog: this.degradationLog.slice(-10) // 最近 10 筆
    };
  }

  /**
   * 重置降級狀態
   */
  reset() {
    this.degradationMode = false;
    this.activeStrategies.clear();
    console.log('✅ 降級狀態已重置');
  }
}

// 單例模式
let instance = null;

function getInstance(options = {}) {
  if (!instance) {
    instance = new GracefulDegradation(options);
  }
  return instance;
}

module.exports = {
  GracefulDegradation,
  getInstance,
  STRATEGIES
};
