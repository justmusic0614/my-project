/**
 * 統一快取管理器
 * 目的：消除 financial-data-fetcher.js, chip-data-fetcher.js 中的重複快取邏輯
 * 
 * 功能：
 * - TTL 管理
 * - 自動過期檢查
 * - 命中率統計
 * - 批次失效
 * - Atomic write
 */

const fs = require('fs');
const path = require('path');

class CacheManager {
  constructor(baseDir, options = {}) {
    this.baseDir = baseDir;
    this.stats = {
      hits: 0,
      misses: 0,
      writes: 0,
      invalidations: 0
    };
    this.logger = options.logger || console;
    this.ensureDir();
  }

  /**
   * 確保快取目錄存在
   */
  ensureDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * 獲取快取
   * @param {string} key - 快取鍵
   * @param {number} ttl - 過期時間（毫秒），0 表示永不過期
   * @returns {any|null} 快取資料或 null
   */
  get(key, ttl = 0) {
    const cachePath = this.getCachePath(key);
    
    if (!fs.existsSync(cachePath)) {
      this.stats.misses++;
      return null;
    }

    try {
      const stat = fs.statSync(cachePath);
      const age = Date.now() - stat.mtimeMs;
      
      // 檢查過期（ttl = 0 表示永不過期）
      if (ttl > 0 && age > ttl) {
        this.stats.misses++;
        this.logger.info(`⏰ 快取過期：${key}（${Math.floor(age / 60000)} 分鐘前）`);
        return null;
      }

      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      this.stats.hits++;
      this.logger.info(`✅ 使用快取：${key}`);
      return data;
      
    } catch (error) {
      this.stats.misses++;
      this.logger.error(`❌ 讀取快取失敗：${key}`, error.message);
      return null;
    }
  }

  /**
   * 設置快取
   * @param {string} key - 快取鍵
   * @param {any} data - 要快取的資料
   * @param {object} options - 選項（metadata, pretty）
   */
  set(key, data, options = {}) {
    const cachePath = this.getCachePath(key);
    
    try {
      // 準備資料（支援 metadata）
      const cacheData = options.metadata ? {
        _metadata: {
          timestamp: new Date().toISOString(),
          ...options.metadata
        },
        data
      } : data;

      // Atomic write（先寫入臨時檔案，再重命名）
      const tempPath = `${cachePath}.tmp`;
      const content = options.pretty 
        ? JSON.stringify(cacheData, null, 2)
        : JSON.stringify(cacheData);
      
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, cachePath);
      
      this.stats.writes++;
      this.logger.info(`💾 已快取：${key}`);
      
    } catch (error) {
      this.logger.error(`❌ 寫入快取失敗：${key}`, error.message);
      throw error;
    }
  }

  /**
   * 失效快取
   * @param {string|RegExp} pattern - 快取鍵或 pattern（支援 glob）
   */
  invalidate(pattern) {
    try {
      const files = fs.readdirSync(this.baseDir);
      let count = 0;

      for (const file of files) {
        const key = file.replace('.json', '');
        
        // 支援字串或正則
        const match = typeof pattern === 'string'
          ? key === pattern || this.matchGlob(key, pattern)
          : pattern.test(key);
          
        if (match) {
          const filePath = path.join(this.baseDir, file);
          fs.unlinkSync(filePath);
          count++;
        }
      }

      this.stats.invalidations += count;
      this.logger.info(`🗑️  已失效 ${count} 個快取（pattern: ${pattern}）`);
      return count;
      
    } catch (error) {
      this.logger.error(`❌ 失效快取失敗：${pattern}`, error.message);
      return 0;
    }
  }

  /**
   * 清除所有快取
   */
  clear() {
    try {
      if (fs.existsSync(this.baseDir)) {
        fs.rmSync(this.baseDir, { recursive: true });
        this.ensureDir();
        this.logger.info('✅ 快取已清除');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('❌ 清除快取失敗', error.message);
      return false;
    }
  }

  /**
   * 獲取統計資訊
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 
      ? (this.stats.hits / totalRequests * 100).toFixed(2)
      : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      writes: this.stats.writes,
      invalidations: this.stats.invalidations,
      hitRate: `${hitRate}%`,
      totalSize: this.getTotalSize(),
      fileCount: this.getFileCount()
    };
  }

  /**
   * 獲取快取總大小（bytes）
   */
  getTotalSize() {
    try {
      if (!fs.existsSync(this.baseDir)) return 0;
      
      const files = fs.readdirSync(this.baseDir);
      let totalSize = 0;
      
      for (const file of files) {
        const filePath = path.join(this.baseDir, file);
        const stat = fs.statSync(filePath);
        totalSize += stat.size;
      }
      
      return totalSize;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 獲取快取檔案數量
   */
  getFileCount() {
    try {
      if (!fs.existsSync(this.baseDir)) return 0;
      return fs.readdirSync(this.baseDir).length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * 獲取快取路徑
   */
  getCachePath(key) {
    return path.join(this.baseDir, `${key}.json`);
  }

  /**
   * 簡單的 glob 匹配（支援 * 通配符）
   */
  matchGlob(str, pattern) {
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(str);
  }
}

module.exports = CacheManager;
