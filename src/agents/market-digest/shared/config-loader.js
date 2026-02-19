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

class ConfigLoader {
  constructor(configPath) {
    this.configPath = configPath || path.join(__dirname, '../config.json');
    this.config = null;
    this.env = process.env;
    this.interpolationWarnings = [];
    this.missingVars = new Set();
  }

  /**
   * 載入配置
   */
  load() {
    try {
      const content = fs.readFileSync(this.configPath, 'utf8');
      const rawConfig = JSON.parse(content);

      // 重置診斷狀態
      this.interpolationWarnings = [];
      this.missingVars.clear();

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
   * 支援格式：${VAR} 或 ${VAR:-default}
   */
  replaceEnvVars(str) {
    // 匹配 ${VAR} 或 ${VAR:-default}
    return str.replace(/\${([^}:]+)(?::-([^}]*))?}/g, (match, varName, defaultValue) => {
      const value = this.env[varName];

      // 優先使用環境變數（非空）
      if (value !== undefined && value !== '') {
        return value;
      }

      // 其次使用預設值
      if (defaultValue !== undefined) {
        this.interpolationWarnings.push({
          variable: varName,
          reason: 'using-default',
          defaultValue
        });
        return defaultValue;
      }

      // 記錄缺失的變數
      this.missingVars.add(varName);
      this.interpolationWarnings.push({
        variable: varName,
        reason: 'not-found'
      });

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
   * 獲取環境變數診斷報告
   */
  getEnvDiagnostics() {
    return {
      totalWarnings: this.interpolationWarnings.length,
      missingVars: Array.from(this.missingVars),
      warnings: this.interpolationWarnings
    };
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
    const missing = [];
    const placeholders = [];

    for (const key of expectedKeys) {
      const value = this.getApiKey(key);

      if (!value) {
        missing.push(key);
      } else if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        placeholders.push({ key, placeholder: value });
      }
    }

    // 檢查 Telegram 特殊結構
    const telegramConfig = this.get('apiKeys.telegram', {});
    if (typeof telegramConfig === 'object' && telegramConfig.botToken?.startsWith('${')) {
      placeholders.push({ key: 'telegram.botToken', placeholder: telegramConfig.botToken });
    }

    if (placeholders.length > 0) {
      const msg = `Env interpolation failed: ${placeholders.map(p => `${p.key}=${p.placeholder}`).join(', ')}`;
      if (strict) {
        throw new Error(msg);
      }
    }

    if (missing.length > 0 && !strict) {
      // 非嚴格模式僅記錄，不拋錯
    }

    return {
      valid: missing.length === 0 && placeholders.length === 0,
      missing,
      placeholders
    };
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
