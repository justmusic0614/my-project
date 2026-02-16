const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parseCron, getNextRun, humanReadable, expandForWeek } = require('../utils/cron-parser');
const { readLastLines, watchAndStream } = require('../utils/log-reader');

const overrideService = require('./schedule-override-service');

const ENV = process.env.KANBAN_ENV || 'dev';

// Memory estimates per agent (MB)
const AGENT_MEMORY_ESTIMATES = {
  'knowledge-digest': 120,
  'market-digest': 100,
  'deploy-monitor': 50,
  'security-patrol': 80,
  'optimization-advisor': 150
};

const SYSTEM_MEMORY = {
  baseMB: 400,
  kanbanMB: 150,
  totalRamMB: 2048,
  availableMB: 1100
};

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

  // Filter out invalid agents
  const validAgents = dirs.filter(name => {
    // Exclude kanban-dashboard (self)
    if (name === 'kanban-dashboard') return false;
    
    // Exclude shared directory
    if (name === 'shared') return false;
    
    // Exclude backup/legacy directories
    if (name.includes('.backup') || name.includes('.legacy') || name.includes('.old')) return false;
    
    // Check if directory has agent structure
    const agentPath = path.join(agentsDir, name);

    try {
      const files = fs.readdirSync(agentPath);

      // Check for scripts/ directory
      const hasScripts = fs.existsSync(path.join(agentPath, 'scripts'));

      // Check for standard agent.js
      const hasAgentJs = fs.existsSync(path.join(agentPath, 'agent.js'));

      // Check for other agent-related JS files (e.g., patrol.js, digest.js)
      const hasOtherAgentFiles = files.some(f => {
        if (!f.endsWith('.js')) return false;
        if (f.startsWith('test-')) return false;
        if (f.includes('setup')) return false;
        return true;
      });

      return hasScripts || hasAgentJs || hasOtherAgentFiles;
    } catch (err) {
      return false;
    }
  });

  return validAgents.map(name => getAgentStatus(name));
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

  const sorted = schedule.sort((a, b) => new Date(a.start) - new Date(b.start));
  return overrideService.applyOverrides(sorted);
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
  getWeeklySchedule,
  AGENT_MEMORY_ESTIMATES,
  SYSTEM_MEMORY
};
