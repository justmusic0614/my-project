const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const { generateSummary } = require('../services/summary-service');

// GET /api/dashboard/summary
router.get('/summary', asyncHandler(async (req, res) => {
  const summary = generateSummary();
  res.json(summary);
}));

module.exports = router;
