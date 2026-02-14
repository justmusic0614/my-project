/**
 * Ollama 檢測與管理服務
 * 用於檢測本地 Ollama 實例的可用性和管理模型
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_TIMEOUT = 2000; // 2 秒超時

/**
 * 檢查 Ollama 是否可用
 * @returns {Promise<boolean>}
 */
async function isOllamaAvailable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const response = await fetch(`${OLLAMA_BASE_URL}/api/version`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    // Timeout 或連線失敗
    return false;
  }
}

/**
 * 取得已安裝的 Ollama 模型列表
 * @returns {Promise<Array>} 模型列表
 */
async function listModels() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return data.models || [];
  } catch (error) {
    console.error('Failed to list Ollama models:', error.message);
    return [];
  }
}

/**
 * 檢查特定模型是否已安裝
 * @param {string} modelName - 模型名稱（例如：llama3.2, phi4）
 * @returns {Promise<boolean>}
 */
async function isModelInstalled(modelName) {
  const models = await listModels();
  return models.some(model => model.name.startsWith(modelName));
}

/**
 * 取得 Ollama 狀態摘要
 * @returns {Promise<object>}
 */
async function getStatus() {
  const available = await isOllamaAvailable();

  if (!available) {
    return {
      available: false,
      models: [],
      totalModels: 0,
      baseUrl: OLLAMA_BASE_URL
    };
  }

  const models = await listModels();

  return {
    available: true,
    models: models.map(model => ({
      name: model.name,
      size: model.size,
      modified: model.modified_at
    })),
    totalModels: models.length,
    baseUrl: OLLAMA_BASE_URL
  };
}

/**
 * 拉取（下載）新模型（可選功能）
 * 注意：這個操作可能需要很長時間，建議在背景執行
 * @param {string} modelName - 模型名稱
 * @returns {Promise<object>}
 */
async function pullModel(modelName) {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName })
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.status}`);
    }

    // 這是一個串流回應，需要逐行讀取進度
    // 這裡簡化處理，返回成功訊息
    return {
      success: true,
      message: `Model ${modelName} pull initiated`
    };
  } catch (error) {
    console.error('Failed to pull Ollama model:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  isOllamaAvailable,
  listModels,
  isModelInstalled,
  getStatus,
  pullModel,
  OLLAMA_BASE_URL
};
