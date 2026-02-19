/**
 * API Keys Manager - 統一 API key 訪問層
 *
 * 優先級：
 * 1. config.json apiKeys 區塊（通過環境變數替換）
 * 2. 直接 process.env（向後相容）
 */

const { getConfig } = require('./config-loader');
const { createLogger } = require('./logger');

const logger = createLogger('api-keys');

class ApiKeysManager {
  constructor() {
    this.config = getConfig();
    this.degradationStatus = new Map();
  }

  /**
   * 獲取 API key（統一介面）
   * @param {string} provider - 服務商（fmp, perplexity, anthropic, finmind）
   * @param {object} options - { required: boolean, fallbackEnv: string }
   */
  get(provider, options = {}) {
    const { required = false, fallbackEnv = null } = options;

    // 優先從 config-loader 獲取（已處理環境變數替換）
    let key = this.config.getApiKey(provider);

    // 檢查是否為未替換的佔位符
    if (key && key.startsWith('${') && key.endsWith('}')) {
      logger.warn(`API key for ${provider} is an unreplaced placeholder: ${key}`);
      key = null;
    }

    // Fallback to process.env（向後相容）
    if (!key && fallbackEnv) {
      key = process.env[fallbackEnv];
    }

    // 處理缺失的 key
    if (!key) {
      if (!this.degradationStatus.has(provider)) {
        this.degradationStatus.set(provider, {
          provider,
          degraded: !required,
          since: new Date().toISOString()
        });
      }

      if (required) {
        throw new Error(
          `Required API key missing: ${provider}\n` +
          `  Environment variable: ${fallbackEnv || `config.apiKeys.${provider}`}`
        );
      }

      logger.debug(`API key not configured: ${provider}`);
    }

    return key || '';
  }

  /**
   * 獲取降級狀態報告
   */
  getDegradationReport() {
    return {
      degradedServices: Array.from(this.degradationStatus.values()),
      count: this.degradationStatus.size
    };
  }

  /**
   * 快捷方法
   */
  getFmp() {
    return this.get('fmp', { fallbackEnv: 'FMP_API_KEY' });
  }

  getPerplexity() {
    return this.get('perplexity', { fallbackEnv: 'PERPLEXITY_API_KEY' });
  }

  getAnthropic() {
    return this.get('anthropic', { fallbackEnv: 'ANTHROPIC_API_KEY' });
  }

  getFinmind() {
    return this.get('finmind', { fallbackEnv: 'FINMIND_API_TOKEN' });
  }

  getTelegram() {
    const telegramConfig = this.config.get('apiKeys.telegram', {});
    let botToken = telegramConfig.botToken || '';
    let chatId = telegramConfig.chatId || '';

    // 檢查佔位符
    if (botToken.startsWith('${')) {
      logger.warn(`Telegram botToken is an unreplaced placeholder: ${botToken}`);
      botToken = '';
    }
    if (chatId.startsWith('${')) {
      logger.warn(`Telegram chatId is an unreplaced placeholder: ${chatId}`);
      chatId = '';
    }

    // Fallback to process.env
    if (!botToken) botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!chatId) chatId = process.env.TELEGRAM_CHAT_ID || '';

    return { botToken, chatId };
  }

  getSecEdgar() {
    return this.get('secEdgar', { fallbackEnv: 'SEC_EDGAR_USER_AGENT' });
  }

  getFred() {
    return this.get('fred', { fallbackEnv: 'FRED_API_KEY' });
  }

  /**
   * 檢查所有 API keys 狀態
   */
  checkStatus() {
    return {
      fmp: !!this.getFmp(),
      perplexity: !!this.getPerplexity(),
      anthropic: !!this.getAnthropic(),
      finmind: !!this.getFinmind(),
      telegram: !!(this.getTelegram().botToken && this.getTelegram().chatId),
      secEdgar: !!this.getSecEdgar(),
      fred: !!this.getFred()
    };
  }

  /**
   * 生成配置報告（用於健康檢查）
   */
  generateReport() {
    const status = this.checkStatus();
    const configured = Object.keys(status).filter(k => status[k]);
    const missing = Object.keys(status).filter(k => !status[k]);

    return {
      total: Object.keys(status).length,
      configured: configured.length,
      missing: missing.length,
      details: status,
      missingKeys: missing
    };
  }
}

// Singleton
let instance = null;

function getApiKeys() {
  if (!instance) {
    instance = new ApiKeysManager();
  }
  return instance;
}

function resetApiKeys() {
  instance = null;
}

module.exports = {
  ApiKeysManager,
  getApiKeys,
  resetApiKeys
};
