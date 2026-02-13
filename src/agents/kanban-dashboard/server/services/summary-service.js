const taskService = require('./task-service');
const agentService = require('./agent-service');

function generateSummary() {
  const tasks = taskService.getAllTasks();
  const agents = agentService.getAgentList();

  // Task overview
  const columns = {};
  for (const t of tasks) {
    columns[t.column] = (columns[t.column] || 0) + 1;
  }

  const now = new Date();
  const overdue = tasks.filter(t =>
    t.dueDate && new Date(t.dueDate) < now && !['done', 'archive'].includes(t.column)
  );

  const today = now.toISOString().split('T')[0];
  const completedToday = tasks.filter(t =>
    t.column === 'done' && t.updatedAt && t.updatedAt.startsWith(today)
  );

  // Agent health
  const agentHealth = agents.map(a => ({
    name: a.name,
    status: a.status,
    nextRun: a.nextRun
  }));

  const running = agents.filter(a => a.status === 'running').length;
  const scheduled = agents.filter(a => a.status === 'scheduled').length;
  const stopped = agents.filter(a => a.status === 'stopped' || a.status === 'error').length;

  // Recent activity (from task timestamps)
  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 10)
    .map(t => ({
      type: 'task',
      title: t.title,
      column: t.column,
      updatedAt: t.updatedAt
    }));

  // Upcoming schedule (next 5 agent runs)
  const upcoming = agents
    .filter(a => a.nextRun)
    .sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun))
    .slice(0, 5)
    .map(a => ({
      agent: a.name,
      nextRun: a.nextRun,
      human: a.human
    }));

  return {
    overview: {
      total: tasks.length,
      byColumn: columns,
      overdue: overdue.length,
      completedToday: completedToday.length,
      active: tasks.filter(t => ['todo', 'ongoing', 'pending', 'review'].includes(t.column)).length,
      done: tasks.filter(t => t.column === 'done').length,
      completionRate: tasks.length > 0
        ? Math.round((tasks.filter(t => t.column === 'done').length / tasks.length) * 100)
        : 0
    },
    agentHealth: {
      total: agents.length,
      running,
      scheduled,
      stopped,
      agents: agentHealth
    },
    recentActivity: recentTasks,
    upcomingSchedule: upcoming,
    generatedAt: now.toISOString()
  };
}

module.exports = { generateSummary };
