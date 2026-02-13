const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const agentService = require('../services/agent-service');

// GET /api/agents/status - All agents status
router.get('/status', asyncHandler(async (req, res) => {
  const agents = agentService.getAgentList();
  res.json({ agents });
}));

// GET /api/agents/schedule - Weekly schedule
router.get('/schedule', asyncHandler(async (req, res) => {
  const week = req.query.week || getMonday(new Date()).toISOString().split('T')[0];
  const schedule = agentService.getWeeklySchedule(week);
  res.json({ schedule, week });
}));

// GET /api/agents/:name - Single agent detail
router.get('/:name', asyncHandler(async (req, res) => {
  const agent = agentService.getAgentStatus(req.params.name);
  const logs = agentService.getAgentLogs(req.params.name, 50);
  res.json({ agent, logs });
}));

// GET /api/agents/:name/logs - Agent logs
router.get('/:name/logs', asyncHandler(async (req, res) => {
  const lines = parseInt(req.query.lines) || 200;
  const logs = agentService.getAgentLogs(req.params.name, lines);
  res.json({ logs });
}));

// GET /api/agents/:name/logs/stream - SSE log streaming
router.get('/:name/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write(`data: Connected to ${req.params.name} log stream\n\n`);

  const watcher = agentService.streamAgentLogs(req.params.name, res);

  req.on('close', () => {
    watcher.close();
  });
});

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

module.exports = router;
