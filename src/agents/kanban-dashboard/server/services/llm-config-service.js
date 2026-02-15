const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
 * 同步模型設定到 OpenClaw
 * 將 Dashboard 的模型 ID 轉換為 OpenClaw 格式並更新全局配置
 */
function syncModelToOpenClaw(dashboardModelId) {
  // 模型 ID 轉換對應表：Dashboard 格式 → OpenClaw 格式
  const modelMapping = {
    'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929': 'anthropic/claude-sonnet-4-5',
    'claude-opus-4-6': 'anthropic/claude-opus-4-6',
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4o-mini': 'openai/gpt-4o-mini'
  };

  const openclawModelId = modelMapping[dashboardModelId];
  if (!openclawModelId) {
    console.warn(`[Model Sync] Unknown model: ${dashboardModelId}`);
    return;
  }

  try {
    const nvmBinDir = '/home/clawbot/.nvm/versions/node/v22.22.0/bin';
    const openclawPath = `${nvmBinDir}/openclaw`;
    const env = {
      ...process.env,
      PATH: `${nvmBinDir}:${process.env.PATH || ''}`
    };

    // 使用 openclaw models set 指令更新全局預設模型
    const command = `${openclawPath} models set ${openclawModelId}`;

    execSync(command, {
      encoding: 'utf8',
      timeout: 10000,
      shell: '/bin/bash',
      env
    });

    console.log(`[Model Sync] ✅ OpenClaw model updated to: ${openclawModelId}`);
  } catch (error) {
    console.error(`[Model Sync] ❌ Failed to sync model:`, error.message);
  }
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

    // 🆕 同步到 OpenClaw（不阻塞主流程）
    try {
      syncModelToOpenClaw(modelId);
    } catch (error) {
      // 同步失敗不影響主流程
      console.error('[Model Sync] Failed but continuing:', error.message);
    }

    return config;
  });
}

/**
 * 取得所有 Agent 的模型配置
 * @returns {object} - { agentName: modelId }
 */
async function getAgentModels() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  return config.agentModels || {};
}

/**
 * 更新單一 Agent 的模型配置
 * @param {string} agentName - Agent 名稱
 * @param {string|null} modelId - 模型 ID（null 代表刪除，回歸 currentModel）
 */
async function updateAgentModel(agentName, modelId) {
  // 若 modelId 不為 null，驗證模型
  if (modelId) {
    const validation = await validateModel(modelId);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
  }

  return mutex.withLock(() => {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

    if (!config.agentModels) {
      config.agentModels = {};
    }

    if (modelId === null) {
      delete config.agentModels[agentName];
    } else {
      config.agentModels[agentName] = modelId;
    }

    config.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return config;
  });
}

module.exports = {
  getConfig,
  getAvailableModels,
  validateModel,
  updateCurrentModel,
  getAgentModels,      // 新增
  updateAgentModel     // 新增
};
