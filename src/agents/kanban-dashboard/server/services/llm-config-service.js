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
 * 同步全局默認模型到 OpenClaw CLI 配置
 * Dashboard "Global Default" → ~/.openclaw/openclaw.json .agents.defaults.model.primary
 * 這個配置會被 openclaw CLI 使用（Dashboard Telegram webhook 使用 openclaw agent 命令）
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
    console.warn(`[Model Sync] ⚠️ Unknown model: ${dashboardModelId}`);
    return false;
  }

  try {
    const configPath = '/home/clawbot/.openclaw/openclaw.json';

    // 1️⃣ 驗證配置文件存在
    try {
      execSync(`test -f ${configPath}`, { timeout: 5000, shell: '/bin/bash' });
    } catch {
      console.error(`[Model Sync] ❌ Config file not found: ${configPath}`);
      return false;
    }

    // 2️⃣ 更新 OpenClaw CLI 的默認模型配置
    // Dashboard Telegram webhook 使用 openclaw agent --agent main 命令
    // main agent 的 model 為 null，所以會使用 .agents.defaults.model.primary
    const command = `jq '.agents.defaults.model.primary = "${openclawModelId}"' ${configPath} > ${configPath}.tmp && mv ${configPath}.tmp ${configPath}`;

    execSync(command, {
      encoding: 'utf8',
      timeout: 10000,
      shell: '/bin/bash'
    });

    // 3️⃣ 驗證更新成功
    const verified = execSync(
      `jq -r '.agents.defaults.model.primary' ${configPath}`,
      { encoding: 'utf8', timeout: 5000, shell: '/bin/bash' }
    ).trim();

    if (verified === openclawModelId) {
      console.log(`[Model Sync] ✅ OpenClaw global default model updated to: ${openclawModelId}`);
      return true;
    } else {
      console.error(`[Model Sync] ❌ Verification failed. Expected: ${openclawModelId}, Got: ${verified}`);
      return false;
    }
  } catch (error) {
    console.error(`[Model Sync] ❌ Failed to sync global model:`, {
      message: error.message,
      stderr: error.stderr?.toString(),
      stdout: error.stdout?.toString()
    });
    return false;
  }
}

/**
 * 同步個別 Agent 模型到 OpenClaw
 * @param {string} agentName - Agent 名稱（例如：knowledge-digest）
 * @param {string} dashboardModelId - Dashboard 模型 ID
 */
function syncAgentModelToOpenClaw(agentName, dashboardModelId) {
  // 模型 ID 轉換對應表
  const modelMapping = {
    'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929': 'anthropic/claude-sonnet-4-5',
    'claude-opus-4-6': 'anthropic/claude-opus-4-6',
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4o-mini': 'openai/gpt-4o-mini'
  };

  const openclawModelId = modelMapping[dashboardModelId];
  if (!openclawModelId) {
    console.warn(`[Agent Model Sync] ⚠️ Unknown model: ${dashboardModelId}`);
    return false;
  }

  try {
    const configPath = '/home/clawbot/.openclaw/openclaw.json';

    // 1️⃣ 驗證配置文件存在
    try {
      execSync(`test -f ${configPath}`, { timeout: 5000, shell: '/bin/bash' });
    } catch {
      console.error(`[Agent Model Sync] ❌ Config file not found: ${configPath}`);
      return false;
    }

    // 2️⃣ 使用 jq 更新全局配置中的 agent 模型
    // OpenClaw agents 配置存在於 .agents.list 陣列中
    const command = `jq '(.agents.list[] | select(.id == "${agentName}")).model = "${openclawModelId}"' ${configPath} > ${configPath}.tmp && mv ${configPath}.tmp ${configPath}`;

    execSync(command, {
      encoding: 'utf8',
      timeout: 10000,
      shell: '/bin/bash'
    });

    // 3️⃣ 驗證更新成功
    const verified = execSync(
      `jq -r '.agents.list[] | select(.id == "${agentName}") | .model' ${configPath}`,
      { encoding: 'utf8', timeout: 5000, shell: '/bin/bash' }
    ).trim();

    if (verified === openclawModelId) {
      console.log(`[Agent Model Sync] ✅ ${agentName} model updated to: ${openclawModelId}`);
      return true;
    } else {
      console.error(`[Agent Model Sync] ❌ Verification failed for ${agentName}. Expected: ${openclawModelId}, Got: ${verified}`);
      return false;
    }
  } catch (error) {
    console.error(`[Agent Model Sync] ❌ Failed to sync ${agentName}:`, {
      message: error.message,
      stderr: error.stderr?.toString(),
      stdout: error.stdout?.toString()
    });
    return false;
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

    // 🆕 同步到 OpenClaw agent（不阻塞主流程）
    if (modelId !== null) {
      try {
        syncAgentModelToOpenClaw(agentName, modelId);
      } catch (error) {
        console.error('[Agent Model Sync] Failed but continuing:', error.message);
      }
    }

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
