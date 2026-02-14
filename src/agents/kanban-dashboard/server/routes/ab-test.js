const express = require('express');
const router = express.Router();
const abTestService = require('../services/ab-test-service');

/**
 * A/B 測試 API 路由
 */

/**
 * POST /api/ab-test/run
 * 執行 A/B 測試（並行調用多個模型）
 * Body: { prompt, models, maxTokens }
 */
router.post('/run', async (req, res, next) => {
  try {
    const { prompt, models, maxTokens } = req.body;

    // 驗證參數
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    if (!models || !Array.isArray(models) || models.length < 2 || models.length > 4) {
      return res.status(400).json({
        error: 'models must be an array with 2-4 model IDs'
      });
    }

    const result = await abTestService.runComparison(prompt, models, { maxTokens });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ab-test/history?limit=50&offset=0
 * 取得測試歷史
 */
router.get('/history', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        error: 'Invalid limit parameter. Must be between 1 and 100.'
      });
    }

    if (offset < 0) {
      return res.status(400).json({
        error: 'Invalid offset parameter. Must be >= 0.'
      });
    }

    const result = abTestService.getComparisons({ limit, offset });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ab-test/:id
 * 取得單一測試詳情
 */
router.get('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const test = abTestService.getComparison(id);
    res.json(test);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/ab-test/:id/rate
 * 為測試結果評分
 * Body: { modelId, rating }
 */
router.put('/:id/rate', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { modelId, rating } = req.body;

    if (!modelId) {
      return res.status(400).json({ error: 'modelId is required' });
    }

    if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'rating must be an integer between 1 and 5'
      });
    }

    const result = await abTestService.rateResponse(id, modelId, rating);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/ab-test/stats/leaderboard
 * 取得模型排行榜
 */
router.get('/stats/leaderboard', (req, res, next) => {
  try {
    const leaderboard = abTestService.getLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
