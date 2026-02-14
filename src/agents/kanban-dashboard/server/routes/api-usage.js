const express = require('express');
const router = express.Router();
const apiUsageService = require('../services/api-usage-service');

/**
 * API 使用統計路由
 */

/**
 * GET /api/api-usage/summary
 * 取得總體統計摘要
 */
router.get('/summary', (req, res, next) => {
  try {
    const summary = apiUsageService.getSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/api-usage/daily?days=7
 * 取得每日使用趨勢（時間序列）
 */
router.get('/daily', (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 7;

    // 驗證 days 參數
    if (days < 1 || days > 90) {
      return res.status(400).json({
        error: 'Invalid days parameter. Must be between 1 and 90.'
      });
    }

    const dailyUsage = apiUsageService.getDailyUsage(days);
    res.json(dailyUsage);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/api-usage/by-model
 * 取得按模型分組的統計
 */
router.get('/by-model', (req, res, next) => {
  try {
    const modelComparison = apiUsageService.getModelComparison();
    res.json(modelComparison);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/api-usage/calls?limit=50&offset=0
 * 取得最近的調用記錄
 */
router.get('/calls', (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // 驗證參數
    if (limit < 1 || limit > 1000) {
      return res.status(400).json({
        error: 'Invalid limit parameter. Must be between 1 and 1000.'
      });
    }

    if (offset < 0) {
      return res.status(400).json({
        error: 'Invalid offset parameter. Must be >= 0.'
      });
    }

    const result = apiUsageService.getRecentCalls(limit, offset);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
