const fs = require('fs');
const path = require('path');
const { createMutex } = require('../middleware/file-mutex');
const ollamaService = require('./ollama-service');

const CONFIG_FILE = path.join(__dirname, '../../data/llm-config.json');
const mutex = createMutex(CONFIG_FILE);

/**
 * 讀取 LLM 配置（含 API Key 可用性檢查）
 */
async function getConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

    // 檢查 API Key 和 Ollama 可用性
    const ollamaAvailable = await ollamaService.isOllamaAvailable();

    config.apiKeysAvailable = {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      ollama: ollamaAvailable
    };

    // 過濾出可用的模型（有對應 API Key 或 Ollama 可用）
    config.availableModels = config.models.filter(m =>
      config.apiKeysAvailable[m.provider]
    );

    // 如果 Ollama 可用，加入已安裝的模型資訊
    if (ollamaAvailable) {
      const ollamaModels = await ollamaService.listModels();
      config.ollamaInstalledModels = ollamaModels.map(m => m.name);
    } else {
      config.ollamaInstalledModels = [];
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to read LLM config: ${error.message}`);
  }
}

/**
 * 取得可用模型列表
 */
async function getAvailableModels() {
  const config = await getConfig();
  return config.availableModels;
}

/**
 * 驗證模型 ID 是否有效
 */
async function validateModel(modelId) {
  const config = await getConfig();
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
async function updateCurrentModel(modelId) {
  // 驗證模型
  const validation = await validateModel(modelId);
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
