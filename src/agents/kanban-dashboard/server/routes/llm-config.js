const express = require('express');
const router = express.Router();
const llmConfigService = require('../services/llm-config-service');

/**
 * GET /api/llm-config
 * 取得配置和可用模型列表
 */
router.get('/', async (req, res, next) => {
  try {
    const config = await llmConfigService.getConfig();
    res.json({
      currentModel: config.currentModel,
      models: config.models,
      availableModels: config.availableModels,
      apiKeysAvailable: config.apiKeysAvailable,
      ollamaInstalledModels: config.ollamaInstalledModels,
      lastUpdated: config.lastUpdated
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/llm-config/model
 * 更新當前模型
 * Body: { modelId: "claude-sonnet-4-5-20250929" }
 */
router.put('/model', async (req, res, next) => {
  try {
    const { modelId } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }

    const config = await llmConfigService.updateCurrentModel(modelId);
    res.json({
      success: true,
      currentModel: config.currentModel,
      lastUpdated: config.lastUpdated
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('not available')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * GET /api/llm-config/agents
 * 取得所有 Agent 的模型配置
 */
router.get('/agents', async (req, res, next) => {
  try {
    const agentModels = await llmConfigService.getAgentModels();
    const config = await llmConfigService.getConfig();

    res.json({
      agentModels,
      currentModel: config.currentModel,
      availableModels: config.availableModels
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/llm-config/agents/:agentName
 * 更新單一 Agent 的模型配置
 * Body: { modelId: "claude-sonnet-4-5-20250929" } 或 { modelId: null }
 */
router.put('/agents/:agentName', async (req, res, next) => {
  try {
    const { agentName } = req.params;
    const { modelId } = req.body;

    if (modelId === undefined) {
      return res.status(400).json({
        error: 'modelId is required (use null to reset)'
      });
    }

    const config = await llmConfigService.updateAgentModel(agentName, modelId);

    res.json({
      success: true,
      agentName,
      modelId: modelId || config.currentModel,
      message: modelId
        ? `Updated ${agentName} to ${modelId}`
        : `Reset ${agentName} to use global model`
    });
  } catch (error) {
    if (error.message.includes('not found') ||
        error.message.includes('not available')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;
