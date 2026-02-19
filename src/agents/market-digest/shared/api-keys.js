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

    // Fallback to process.env（向後相容）
    if (!key && fallbackEnv) {
      key = process.env[fallbackEnv];
    }

    // 檢查必需性
    if (required && !key) {
      throw new Error(`Required API key missing: ${provider}`);
    }

    if (!key) {
      logger.debug(`API key not configured: ${provider}`);
    }

    return key || '';
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
    return {
      botToken: telegramConfig.botToken || process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: telegramConfig.chatId || process.env.TELEGRAM_CHAT_ID || ''
    };
  }

  getSecEdgar() {
    return this.get('secEdgar', { fallbackEnv: 'SEC_EDGAR_USER_AGENT' });
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
      secEdgar: !!this.getSecEdgar()
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
