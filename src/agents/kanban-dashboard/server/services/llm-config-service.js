const fs = require('fs');
const path = require('path');
const { createMutex } = require('../middleware/file-mutex');

const CONFIG_FILE = path.join(__dirname, '../../data/llm-config.json');
const mutex = createMutex(CONFIG_FILE);

/**
 * 讀取 LLM 配置（含 API Key 可用性檢查）
 */
function getConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

    // 檢查 API Key 可用性
    config.apiKeysAvailable = {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY
    };

    // 過濾出可用的模型（有對應 API Key）
    config.availableModels = config.models.filter(m =>
      config.apiKeysAvailable[m.provider]
    );

    return config;
  } catch (error) {
    throw new Error(`Failed to read LLM config: ${error.message}`);
  }
}

/**
 * 取得可用模型列表
 */
function getAvailableModels() {
  const config = getConfig();
  return config.availableModels;
}

/**
 * 驗證模型 ID 是否有效
 */
function validateModel(modelId) {
  const config = getConfig();
  const model = config.models.find(m => m.id === modelId);

  if (!model) {
    return { valid: false, error: 'Model ID not found' };
  }

  if (!config.apiKeysAvailable[model.provider]) {
    return { valid: false, error: `API key for ${model.provider} not available` };
  }

  return { valid: true, model };
}

/**
 * 更新當前模型
 */
function updateCurrentModel(modelId) {
  // 驗證模型
  const validation = validateModel(modelId);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 使用檔案鎖防止並發衝突
  return mutex.withLock(() => {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    config.currentModel = modelId;
    config.lastUpdated = new Date().toISOString();

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return config;
  });
}

module.exports = {
  getConfig,
  getAvailableModels,
  validateModel,
  updateCurrentModel
};
