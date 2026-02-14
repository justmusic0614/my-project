const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '../../data/llm-config.json');

/**
 * 統一 LLM 客戶端
 * 支援 Anthropic、OpenAI、Ollama 三個 provider
 */

// ============================================================
// Provider Implementations
// ============================================================

/**
 * Anthropic Provider (Claude)
 */
async function callAnthropic(model, prompt, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found in environment');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();

  return {
    text: data.content[0].text,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      totalTokens: data.usage.input_tokens + data.usage.output_tokens
    }
  };
}

/**
 * OpenAI Provider (GPT)
 */
async function callOpenAI(model, prompt, maxTokens) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found in environment');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();

  return {
    text: data.choices[0].message.content,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens
    }
  };
}

/**
 * Ollama Provider (本地模型)
 */
async function callOllama(model, prompt, maxTokens) {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';

  const res = await fetch(`${ollamaHost}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { num_predict: maxTokens }
    })
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Ollama API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();

  return {
    text: data.response,
    usage: {
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
    }
  };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * 載入模型配置
 */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (error) {
    throw new Error(`Failed to load LLM config: ${error.message}`);
  }
}

/**
 * 取得模型配置資訊
 */
function getModelConfig(modelId) {
  const config = loadConfig();
  const model = config.models.find(m => m.id === modelId);

  if (!model) {
    throw new Error(`Model not found: ${modelId}`);
  }

  return model;
}

/**
 * 計算成本
 * @param {string} modelId - 模型 ID
 * @param {object} usage - {inputTokens, outputTokens}
 * @returns {object} - {input, output, total}
 */
function calculateCost(modelId, usage) {
  const model = getModelConfig(modelId);

  if (!model.pricing) {
    return { input: 0, output: 0, total: 0 };
  }

  // 價格單位：per million tokens
  const inputCost = (usage.inputTokens / 1000000) * model.pricing.input;
  const outputCost = (usage.outputTokens / 1000000) * model.pricing.output;

  return {
    input: inputCost,
    output: outputCost,
    total: inputCost + outputCost
  };
}

/**
 * 記錄 API 使用
 * （此函數會呼叫 api-usage-service，避免循環依賴問題）
 */
async function trackUsage(callRecord) {
  try {
    // 延遲載入 api-usage-service 避免循環依賴
    const apiUsageService = require('./api-usage-service');
    await apiUsageService.logUsage(callRecord);
  } catch (error) {
    // 追蹤失敗不應影響主要調用
    console.error('⚠️  Failed to track usage:', error.message);
  }
}

// ============================================================
// Main API
// ============================================================

/**
 * 統一 LLM 調用介面（支援 Per-Agent 模型配置）
 * @param {string} prompt - 提示詞
 * @param {object} options - {model, agentId, maxTokens, source}
 * @returns {object} - {text, usage, cost}
 */
async function callLLM(prompt, options = {}) {
  const { model: modelId, agentId, maxTokens = 800, source = 'unknown' } = options;

  // 智慧模型選擇邏輯
  let selectedModel = modelId;

  if (!selectedModel && agentId) {
    // 若沒有指定 model，但有 agentId，查詢 Agent 專用模型
    try {
      const config = loadConfig();
      selectedModel = config.agentModels?.[agentId] || config.currentModel;
    } catch (error) {
      console.warn(`⚠️ Failed to load agent model for ${agentId}, using fallback`);
      selectedModel = 'claude-haiku-4-5-20251001';
    }
  } else if (!selectedModel) {
    // 若都沒有，使用全局 currentModel
    try {
      const config = loadConfig();
      selectedModel = config.currentModel;
    } catch (error) {
      selectedModel = 'claude-haiku-4-5-20251001';
    }
  }

  if (!selectedModel) {
    throw new Error('Model ID is required');
  }

  const startTime = Date.now();
  const modelConfig = getModelConfig(selectedModel);

  let result;
  let error = null;

  try {
    // 根據 provider 調用對應的函數
    if (modelConfig.provider === 'anthropic') {
      result = await callAnthropic(selectedModel, prompt, maxTokens);
    } else if (modelConfig.provider === 'openai') {
      result = await callOpenAI(selectedModel, prompt, maxTokens);
    } else if (modelConfig.provider === 'ollama') {
      result = await callOllama(selectedModel, prompt, maxTokens);
    } else {
      throw new Error(`Unsupported provider: ${modelConfig.provider}`);
    }

    // 計算成本
    const cost = calculateCost(selectedModel, result.usage);
    const latency = Date.now() - startTime;

    // 記錄使用資料（非阻塞）
    const callRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: selectedModel,
      provider: modelConfig.provider,
      usage: result.usage,
      cost,
      latency,
      source,
      status: 'success'
    };

    await trackUsage(callRecord);

    return {
      text: result.text,
      usage: result.usage,
      cost
    };
  } catch (err) {
    error = err;
    const latency = Date.now() - startTime;

    // 記錄失敗的調用
    const callRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      model: modelId,
      provider: modelConfig.provider,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      latency,
      source,
      status: 'error',
      error: err.message
    };

    await trackUsage(callRecord);

    throw err;
  }
}

module.exports = {
  callLLM,
  getModelConfig,
  calculateCost
};
