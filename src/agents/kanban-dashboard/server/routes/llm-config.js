const express = require('express');
const router = express.Router();
const llmConfigService = require('../services/llm-config-service');

/**
 * GET /api/llm-config
 * 取得配置和可用模型列表
 */
router.get('/', (req, res, next) => {
  try {
    const config = llmConfigService.getConfig();
    res.json({
      currentModel: config.currentModel,
      models: config.models,
      availableModels: config.availableModels,
      apiKeysAvailable: config.apiKeysAvailable,
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
router.put('/model', (req, res, next) => {
  try {
    const { modelId } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }

    const config = llmConfigService.updateCurrentModel(modelId);
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

module.exports = router;
