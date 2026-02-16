const taskService = require('./task-service');
const agentService = require('./agent-service');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getBakFileCount() {
  try {
    // 在 VPS 環境，掃描實際目錄
    const clawdDir = process.env.CLAWD_DIR || '/home/clawbot/clawd';

    if (!fs.existsSync(clawdDir)) {
      return 0;  // 開發環境返回 0
    }

    // 使用 find 命令計數 .bak 文件，排除 backups 目錄
    const cmd = `find ${clawdDir} -name "*.bak*" -type f -not -path "*/backups/*" 2>/dev/null | wc -l`;
    const output = execSync(cmd, { encoding: 'utf8' });
    return parseInt(output.trim(), 10) || 0;
  } catch (error) {
    console.error('[SummaryService] Error counting bak files:', error);
    return 0;
  }
}

function generateSummary() {
  const tasks = taskService.getAllTasks();
  const agents = agentService.getAgentList();
  const bakCount = getBakFileCount();  // 新增 BAK 文件計數

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
        : 0,
      bakFiles: bakCount  // 新增 BAK 文件計數欄位
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
