/**
 * Config Loader - 統一配置載入器
 * 功能：
 * - 載入 config.json
 * - 環境變數替換（${VAR} 格式）
 * - 配置驗證
 * - 提供便利方法
 */

const fs = require('fs');
const path = require('path');

// 確保環境變數已載入（雙保險）
const dotenv = require('dotenv');
const centralEnv = path.join(process.env.HOME || '', 'clawd', '.env');
const localEnv = path.join(__dirname, '../.env');
if (fs.existsSync(centralEnv)) {
  dotenv.config({ path: centralEnv });
} else if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv });
}

class ConfigLoader {
  constructor(configPath) {
    this.configPath = configPath || path.join(__dirname, '../config.json');
    this.config = null;
    this.env = process.env;
  }

  /**
   * 載入配置
   */
  load() {
    try {
      const content = fs.readFileSync(this.configPath, 'utf8');
      const rawConfig = JSON.parse(content);
      
      // 環境變數替換
      this.config = this.interpolateEnv(rawConfig);
      
      // 驗證配置
      this.validate();
      
      return this.config;
    } catch (error) {
      throw new Error(`Failed to load config from ${this.configPath}: ${error.message}`);
    }
  }

  /**
   * 遞迴替換環境變數
   */
  interpolateEnv(obj) {
    if (typeof obj === 'string') {
      return this.replaceEnvVars(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateEnv(item));
    }

    if (obj !== null && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateEnv(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * 替換字串中的環境變數
   */
  replaceEnvVars(str) {
    // 匹配 ${VAR} 或 ${VAR:-default}
    return str.replace(/${([^}:]+)(?::-([^}]*))?}/g, (match, varName, defaultValue) => {
      const value = this.env[varName];
      
      if (value !== undefined) {
        return value;
      }
      
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      
      // 保留原始字串（未找到環境變數）
      return match;
    });
  }

  /**
   * 驗證必要配置
   */
  validate() {
    const required = [
      'version',
      'http',
      'cache',
      'deduplication',
      'dataSources',
      'logging'
    ];

    for (const key of required) {
      if (!this.config[key]) {
        throw new Error(`Missing required config key: ${key}`);
      }
    }

    // 驗證 HTTP 配置
    if (!this.config.http.timeout || !this.config.http.retries) {
      throw new Error('Invalid HTTP config: timeout and retries are required');
    }

    // 驗證快取配置
    if (!this.config.cache.ttl) {
      throw new Error('Invalid cache config: ttl is required');
    }
  }

  /**
   * 獲取配置值（支援 dot notation）
   */
  get(keyPath, defaultValue) {
    if (!this.config) {
      this.load();
    }

    const keys = keyPath.split('.');
    let value = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 獲取 HTTP 配置
   */
  getHttp() {
    return this.get('http', {});
  }

  /**
   * 獲取快取配置
   */
  getCache() {
    return this.get('cache', {});
  }

  /**
   * 獲取快取 TTL
   */
  getCacheTTL(key) {
    return this.get(`cache.ttl.${key}`, 3600000);
  }

  /**
   * 獲取去重配置
   */
  getDeduplication() {
    return this.get('deduplication', {});
  }

  /**
   * 獲取資料源配置
   */
  getDataSources() {
    return this.get('dataSources', {});
  }

  /**
   * 獲取 RSS 源
   */
  getRSSSources() {
    return this.get('dataSources.rss', []).filter(src => src.enabled !== false);
  }

  /**
   * 獲取 API 端點
   */
  getAPIEndpoint(provider, endpoint) {
    return this.get(`dataSources.api.${provider}.${endpoint}`);
  }

  /**
   * 獲取日誌配置
   */
  getLogging() {
    return this.get('logging', { level: 'info', format: 'pretty' });
  }

  /**
   * 獲取 Telegram 配置
   */
  getTelegram() {
    return this.get('telegram', {});
  }

  /**
   * 獲取處理配置
   */
  getProcessing() {
    return this.get('processing', {});
  }

  /**
   * 獲取路徑配置
   */
  getPath(key) {
    return this.get(`paths.${key}`, key);
  }

  /**
   * 獲取 SRE 配置
   */
  getSRE() {
    return this.get('sre', {});
  }

  /**
   * 重新載入配置
   */
  reload() {
    this.config = null;
    return this.load();
  }

  /**
   * 導出為 JSON
   */
  toJSON() {
    if (!this.config) {
      this.load();
    }
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 獲取 API Keys 配置區塊
   */
  getApiKeys() {
    return this.get('apiKeys', {});
  }

  /**
   * 獲取特定 API key
   * @param {string} provider - 服務商名稱（fmp, perplexity, anthropic 等）
   * @returns {string|null}
   */
  getApiKey(provider) {
    const keys = this.getApiKeys();
    return keys[provider] || null;
  }

  /**
   * 檢查 API key 是否存在
   */
  hasApiKey(provider) {
    return !!this.getApiKey(provider);
  }

  /**
   * 驗證 API keys 配置（可選：只記錄警告，不阻止啟動）
   */
  validateApiKeys(strict = false) {
    const expectedKeys = ['fmp', 'perplexity', 'anthropic', 'finmind', 'telegram', 'secEdgar'];
    const missing = expectedKeys.filter(k => !this.hasApiKey(k));

    if (missing.length > 0) {
      const msg = `Missing API keys: ${missing.join(', ')}`;
      if (strict) {
        throw new Error(msg);
      } else {
        logger.warn(msg + ' (features will be degraded)');
      }
    }

    return { valid: missing.length === 0, missing };
  }
}

// 單例實例
let instance = null;

/**
 * 獲取單例實例
 */
function getConfig(configPath) {
  if (!instance) {
    instance = new ConfigLoader(configPath);
    instance.load();
  }
  return instance;
}

/**
 * 重置單例（主要用於測試）
 */
function resetConfig() {
  instance = null;
}

module.exports = {
  ConfigLoader,
  getConfig,
  resetConfig
};
