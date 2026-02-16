const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const { generateSummary } = require('../services/summary-service');
const { getSystemHealth, getTechDebtReport } = require('../services/health-monitor-service');
const { checkConsistency } = require('../services/consistency-check');

// GET /api/dashboard/summary
router.get('/summary', asyncHandler(async (req, res) => {
  const summary = generateSummary();
  res.json(summary);
}));

// GET /api/dashboard/health
router.get('/health', asyncHandler(async (req, res) => {
  const health = await getSystemHealth();
  res.json(health);
}));

// GET /api/dashboard/tech-debt-report
router.get('/tech-debt-report', asyncHandler(async (req, res) => {
  const report = await getTechDebtReport();
  res.json(report);
}));

// GET /api/dashboard/consistency - Check system consistency
router.get('/consistency', asyncHandler(async (req, res) => {
  const result = checkConsistency();
  res.json(result);
}));

module.exports = router;
