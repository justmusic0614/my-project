const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseCron, getNextRun, humanReadable, expandForWeek } = require('../utils/cron-parser');
const { readLastLines, watchAndStream } = require('../utils/log-reader');

const ENV = process.env.KANBAN_ENV || 'dev';

// Mock data for development (Real agents from VPS)
const MOCK_AGENTS = [
  { name: 'knowledge-digest', cron: '0 0 * * *', status: 'scheduled' },
  { name: 'market-digest', cron: '0 0 * * *', status: 'scheduled' },
  { name: 'deploy-monitor', cron: '*/30 * * * *', status: 'scheduled' },
  { name: 'optimization-advisor', cron: '15 1-23/2 * * *', status: 'scheduled' },
  { name: 'security-patrol', cron: '0 * * * *', status: 'scheduled' }
];

function getAgentsDir() {
  // Try to read from vps.conf
  const confPath = path.join(__dirname, '../../../main/resources/config/vps.conf');
  if (fs.existsSync(confPath)) {
    const conf = fs.readFileSync(confPath, 'utf8');
    const match = conf.match(/AGENTS_DIR="([^"]+)"/);
    if (match) {
      const resolved = match[1].replace('${OPENCLAW_BASE_DIR}', '/home/clawbot/clawd');
      return resolved;
    }
  }
  return process.env.AGENTS_DIR || '/home/clawbot/clawd/agents';
}

function getAgentList() {
  if (ENV === 'dev') {
    return MOCK_AGENTS.map(a => ({
      name: a.name,
      status: a.status,
      pid: null,
      cron: a.cron,
      human: humanReadable(a.cron),
      nextRun: getNextRun(a.cron)?.toISOString() || null
    }));
  }

  const agentsDir = getAgentsDir();
  if (!fs.existsSync(agentsDir)) return [];

  const dirs = fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  return dirs.map(name => getAgentStatus(name));
}

function getAgentStatus(name) {
  if (ENV === 'dev') {
    const mock = MOCK_AGENTS.find(a => a.name === name);
    if (!mock) return { name, status: 'unknown', pid: null };
    return {
      name,
      status: mock.status,
      pid: null,
      cron: mock.cron,
      human: humanReadable(mock.cron),
      nextRun: getNextRun(mock.cron)?.toISOString() || null
    };
  }

  const agentsDir = getAgentsDir();
  const agentDir = path.join(agentsDir, name);
  const pidFile = path.join(agentDir, 'agent.pid');

  let status = 'stopped';
  let pid = null;

  if (fs.existsSync(pidFile)) {
    pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    try {
      process.kill(pid, 0);
      status = 'running';
    } catch (_) {
      status = 'stopped';
    }
  }

  // Try to get cron schedule
  let cron = null;
  try {
    const crontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    const line = crontab.split('\n').find(l => l.includes(name) && !l.startsWith('#'));
    if (line) {
      const parts = line.trim().split(/\s+/);
      cron = parts.slice(0, 5).join(' ');
      status = status === 'stopped' ? 'scheduled' : status;
    }
  } catch (_) {}

  return {
    name,
    status,
    pid,
    cron,
    human: cron ? humanReadable(cron) : null,
    nextRun: cron ? getNextRun(cron)?.toISOString() : null
  };
}

function getAgentLogs(name, lines = 200) {
  if (ENV === 'dev') {
    return generateMockLogs(name, lines);
  }

  const agentsDir = getAgentsDir();
  const logFile = path.join(agentsDir, name, 'agent.log');
  return readLastLines(logFile, lines);
}

function streamAgentLogs(name, res) {
  if (ENV === 'dev') {
    // Simulate log streaming in dev
    const interval = setInterval(() => {
      const ts = new Date().toISOString();
      res.write(`data: [${ts}] [${name}] Heartbeat check OK\n\n`);
    }, 5000);
    return {
      close: () => clearInterval(interval)
    };
  }

  const agentsDir = getAgentsDir();
  const logFile = path.join(agentsDir, name, 'agent.log');
  return watchAndStream(logFile, (line) => {
    res.write(`data: ${line}\n\n`);
  });
}

function getWeeklySchedule(weekStart) {
  const agents = getAgentList();
  const schedule = [];

  for (const agent of agents) {
    if (!agent.cron) continue;
    const runs = expandForWeek(agent.cron, weekStart);
    for (const run of runs) {
      schedule.push({
        agent: agent.name,
        start: run.toISOString(),
        duration: 300, // default 5 min estimate
        type: 'cron'
      });
    }
  }

  return schedule.sort((a, b) => new Date(a.start) - new Date(b.start));
}

function generateMockLogs(name, count) {
  const logs = [];
  const now = Date.now();
  for (let i = count; i > 0; i--) {
    const ts = new Date(now - i * 60000).toISOString();
    const msgs = [
      `Starting ${name} agent...`,
      'Checking configuration...',
      'Connecting to data source...',
      'Processing entries...',
      `Found 12 items to process`,
      'Processing item 1/12...',
      'Processing item 6/12...',
      'Processing item 12/12...',
      'Generating summary...',
      'Task completed successfully',
      `Sleeping until next scheduled run`
    ];
    logs.push(`[${ts}] [${name}] ${msgs[i % msgs.length]}`);
  }
  return logs.slice(-count);
}

module.exports = {
  getAgentList,
  getAgentStatus,
  getAgentLogs,
  streamAgentLogs,
  getWeeklySchedule
};
