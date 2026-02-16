const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/error-handler');
const taskService = require('../services/task-service');
const agentService = require('../services/agent-service');
const { getAllNotifications } = require('../services/notification-service');

// GET /api/search?q=keyword
router.get('/', asyncHandler(async (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();
  if (!query) {
    return res.json({ results: [], query: '' });
  }

  const results = [];

  // Search tasks
  const allTasks = taskService.getAllTasks({});
  const matchingTasks = allTasks.filter(t =>
    t.title?.toLowerCase().includes(query) ||
    t.description?.toLowerCase().includes(query) ||
    t.tags?.some(tag => tag.toLowerCase().includes(query))
  );
  matchingTasks.forEach(t => {
    results.push({
      type: 'task',
      id: t.id,
      title: t.title,
      subtitle: `${t.column} | ${t.priority}`,
      url: `/board?task=${t.id}`
    });
  });

  // Search agents
  const agents = agentService.getAgentList();
  const matchingAgents = agents.filter(a =>
    a.name.toLowerCase().includes(query)
  );
  matchingAgents.forEach(a => {
    results.push({
      type: 'agent',
      id: a.name,
      title: a.name,
      subtitle: `${a.status}${a.cron ? ' | ' + a.human : ''}`,
      url: `/agents?agent=${a.name}`
    });
  });

  // Search notifications
  try {
    const notifications = getAllNotifications();
    const matchingNotifications = notifications.filter(n =>
      n.message?.toLowerCase().includes(query) ||
      n.title?.toLowerCase().includes(query)
    );
    matchingNotifications.slice(0, 5).forEach(n => {
      results.push({
        type: 'notification',
        id: n.id,
        title: n.title || n.message?.slice(0, 60),
        subtitle: new Date(n.createdAt).toLocaleDateString(),
        url: '/'
      });
    });
  } catch (_) {}

  res.json({ results, query, total: results.length });
}));

module.exports = router;
