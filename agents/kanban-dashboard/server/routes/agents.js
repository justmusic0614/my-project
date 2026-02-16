const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { asyncHandler } = require('../middleware/error-handler');
const agentService = require('../services/agent-service');
const { broadcast } = require('../websocket');

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

// Schedule Override endpoints
const overrideService = require('../services/schedule-override-service');

// POST /api/agents/schedule/override - Create/update schedule override
router.post('/schedule/override', asyncHandler(async (req, res) => {
  const { agent, originalStart, newStart } = req.body;
  if (!agent || !originalStart || !newStart) {
    return res.status(400).json({ error: 'Missing required fields: agent, originalStart, newStart' });
  }
  const override = overrideService.addOverride(agent, originalStart, newStart);
  broadcast('agents:schedule-changed', override);
  res.status(201).json(override);
}));

// DELETE /api/agents/schedule/override/:id - Remove schedule override
router.delete('/schedule/override/:id', asyncHandler(async (req, res) => {
  const removed = overrideService.removeOverride(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Override not found' });
  }
  res.json({ success: true });
}));

// POST /api/agents/schedule/override/recurring - Create recurring overrides
router.post('/schedule/override/recurring', asyncHandler(async (req, res) => {
  const { agent, originalStart, newStart, weeks = 4 } = req.body;
  if (!agent || !originalStart || !newStart) {
    return res.status(400).json({ error: 'Missing required fields: agent, originalStart, newStart' });
  }
  const overrides = overrideService.addRecurringOverride(agent, originalStart, newStart, weeks);
  res.status(201).json({ overrides, count: overrides.length });
}));

// GET /api/agents/memory-estimates - Memory estimates per agent
router.get('/memory-estimates', asyncHandler(async (req, res) => {
  res.json({
    agents: agentService.AGENT_MEMORY_ESTIMATES,
    system: agentService.SYSTEM_MEMORY
  });
}));

// IMPORTANT: More specific routes must come BEFORE /:name

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
    try {
      watcher.close();
    } catch (err) {
      console.error(`Failed to close watcher for ${req.params.name}:`, err.message);
    }
  });
});

// GET /api/agents/:name/logs - Agent logs
router.get('/:name/logs', asyncHandler(async (req, res) => {
  const lines = parseInt(req.query.lines) || 200;
  const logs = agentService.getAgentLogs(req.params.name, lines);
  res.json({ logs });
}));

// GET /api/agents/:name/spec - Agent specification (README.md)
router.get('/:name/spec', asyncHandler(async (req, res) => {
  const agentName = req.params.name;
  const agentDir = path.join(__dirname, '../../../', agentName);
  const readmePath = path.join(agentDir, 'README.md');

  if (!fs.existsSync(readmePath)) {
    return res.status(404).json({
      error: true,
      message: `No specification found for agent: ${agentName}`
    });
  }

  const content = fs.readFileSync(readmePath, 'utf8');
  res.json({ spec: content, agent: agentName });
}));

// GET /api/agents/:name - Single agent detail (MUST be last)
router.get('/:name', asyncHandler(async (req, res) => {
  const agent = agentService.getAgentStatus(req.params.name);
  const logs = agentService.getAgentLogs(req.params.name, 50);
  res.json({ agent, logs });
}));

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

module.exports = router;
