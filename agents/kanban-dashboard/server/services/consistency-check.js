const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const agentService = require('./agent-service');

function checkConsistency() {
  const checks = [];
  const agentsDir = process.env.AGENTS_DIR || '/home/clawbot/clawd/agents';

  // 1. Agent list consistency
  const dashboardAgents = agentService.getAgentList().map(a => a.name).sort();

  let fsAgents = [];
  try {
    fsAgents = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(name => {
        if (name === 'kanban-dashboard' || name === 'shared') return false;
        const agentPath = path.join(agentsDir, name);
        return fs.existsSync(path.join(agentPath, 'scripts')) ||
               fs.existsSync(path.join(agentPath, 'agent.js'));
      })
      .sort();
  } catch (_) {}

  const missingInDashboard = fsAgents.filter(a => !dashboardAgents.includes(a));
  const extraInDashboard = dashboardAgents.filter(a => !fsAgents.includes(a));

  checks.push({
    name: 'agent-list',
    status: missingInDashboard.length === 0 && extraInDashboard.length === 0 ? 'ok' : 'mismatch',
    dashboard: dashboardAgents,
    filesystem: fsAgents,
    missingInDashboard,
    extraInDashboard
  });

  // 2. Crontab consistency
  let crontabAgents = [];
  try {
    const crontab = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
    crontabAgents = crontab.split('\n')
      .filter(l => !l.startsWith('#') && l.includes('agents/'))
      .map(l => {
        const match = l.match(/agents\/([a-z0-9-]+)\//);
        return match ? match[1] : null;
      })
      .filter(Boolean);
  } catch (_) {}

  const agentsWithCron = dashboardAgents.filter(a => {
    const agent = agentService.getAgentList().find(ag => ag.name === a);
    return agent && agent.cron;
  });

  checks.push({
    name: 'crontab',
    status: 'info',
    scheduledInDashboard: agentsWithCron,
    inCrontab: [...new Set(crontabAgents)]
  });

  // 3. Service status
  const services = [];
  try {
    const gateway = execSync('systemctl --user is-active clawdbot-gateway.service 2>/dev/null', { encoding: 'utf8' }).trim();
    services.push({ name: 'clawdbot-gateway', status: gateway });
  } catch (e) {
    services.push({ name: 'clawdbot-gateway', status: 'not-found' });
  }

  try {
    const ollama = execSync('systemctl --user is-active ollama.service 2>/dev/null', { encoding: 'utf8' }).trim();
    services.push({ name: 'ollama', status: ollama });
  } catch (e) {
    services.push({ name: 'ollama', status: 'not-found' });
  }

  checks.push({
    name: 'services',
    status: services.every(s => s.status === 'active') ? 'ok' : 'warning',
    services
  });

  // 4. Config file validation
  const configPath = '/home/clawbot/.openclaw/openclaw.json';
  let configStatus = 'ok';
  let configError = null;
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    JSON.parse(content);
  } catch (err) {
    configStatus = 'error';
    configError = err.message;
  }

  checks.push({
    name: 'config',
    status: configStatus,
    path: configPath,
    error: configError
  });

  // 5. Disk usage
  let diskUsage = null;
  try {
    const df = execSync('df -h /home | tail -1', { encoding: 'utf8' });
    const parts = df.trim().split(/\s+/);
    diskUsage = {
      total: parts[1],
      used: parts[2],
      available: parts[3],
      usePercent: parts[4]
    };
  } catch (_) {}

  checks.push({
    name: 'disk',
    status: diskUsage && parseInt(diskUsage.usePercent) < 80 ? 'ok' : 'warning',
    usage: diskUsage
  });

  // Overall status
  const hasError = checks.some(c => c.status === 'error' || c.status === 'mismatch');
  const hasWarning = checks.some(c => c.status === 'warning');

  return {
    overall: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
    timestamp: new Date().toISOString(),
    checks
  };
}

module.exports = { checkConsistency };
