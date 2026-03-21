#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const RUNTIME_PATH = path.join(__dirname, 'data/runtime/latest.json');
const HISTORY_DIR = path.join(__dirname, 'data/history');

// 讀取設定
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// 執行系統指令並回傳輸出（timeout 防止高負載下指令掛住）
function exec(cmd, timeout = 10000) {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout }).trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

// 監控模組
const monitors = {
  ssh: () => {
    const authLog = exec('sudo tail -n 1000 /var/log/auth.log 2>/dev/null || echo "No access"');
    const failedLogins = (authLog.match(/Failed password/g) || []).length;
    const successLogins = (authLog.match(/Accepted password|Accepted publickey/g) || []).length;
    
    // 提取最近的失敗 IP
    const failedIPs = {};
    const failedLines = authLog.split('\n').filter(line => line.includes('Failed password'));
    failedLines.forEach(line => {
      const match = line.match(/from ([\d\.]+)/);
      if (match) {
        const ip = match[1];
        failedIPs[ip] = (failedIPs[ip] || 0) + 1;
      }
    });
    
    const topFailedIPs = Object.entries(failedIPs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ip, count]) => ({ ip, count }));
    
    return {
      failed_logins: failedLogins,
      success_logins: successLogins,
      top_failed_ips: topFailedIPs,
      alert: failedLogins > config.thresholds.ssh_failed_logins
    };
  },
  
  updates: () => {
    const updates = exec('apt list --upgradable 2>/dev/null | grep -v "Listing" | wc -l', 8000);
    const securityList = exec('apt list --upgradable 2>/dev/null | grep -i security | head -5', 8000);
    const securityPackages = securityList
      .split('\n')
      .filter(l => l.trim() && l !== 'Listing...')
      .map(l => l.split('/')[0])
      .filter(Boolean);

    return {
      total_updates: parseInt(updates) || 0,
      security_updates: securityPackages.length,
      security_packages: securityPackages,
      alert: securityPackages.length > 0
    };
  },
  
  firewall: () => {
    const ufwInstalled = exec('which ufw 2>/dev/null').length > 0;
    const ufwStatus = ufwInstalled
      ? exec('ufw status 2>/dev/null || echo "permission denied"')
      : 'not installed';

    // 收集監聽 port（ss 不需要 sudo，提供資訊性資料）
    const openPorts = exec(
      "ss -tuln 2>/dev/null | grep LISTEN | awk '{print $5}' | grep -oE ':[0-9]+' | sort -t: -k2 -n | uniq"
    ).split('\n').map(p => p.replace(':', '')).filter(Boolean);

    const canCheck = ufwInstalled
      && !ufwStatus.includes('permission denied')
      && !ufwStatus.includes('not installed');
    const isActive = canCheck && ufwStatus.includes('Status: active');

    return {
      firewall_type: ufwInstalled ? 'ufw' : 'none',
      status: canCheck ? (isActive ? 'active' : 'inactive') : 'unable to check (no sudo)',
      active: canCheck ? isActive : null,
      open_ports: openPorts,
      listening_ports_count: openPorts.length,
      alert: canCheck && !isActive,  // 只在確認 inactive 時告警
      note: canCheck ? '' : `ss -tuln 顯示 ${openPorts.length} 個監聽 port（ufw 需 sudo 才能檢測）`
    };
  },
  
  network: () => {
    const connections = exec('ss -tuln | wc -l');
    const established = exec('ss -tun | grep ESTAB | wc -l');
    
    return {
      total_connections: parseInt(connections),
      established_connections: parseInt(established),
      alert: false
    };
  },
  
  disk: () => {
    const df = exec('df -h / | tail -n 1');
    const parts = df.split(/\s+/);
    const usage = parseInt(parts[4]);
    
    return {
      usage_percent: usage,
      total: parts[1],
      used: parts[2],
      available: parts[3],
      alert: usage > config.thresholds.disk_usage_percent
    };
  },
  
  cpu: () => {
    const load = exec('cat /proc/loadavg').split(' ');
    const cores = parseInt(exec('nproc'));
    const usage5 = parseFloat(load[1]) / cores * 100;  // 5 分鐘平均（告警用，平滑 cron 尖峰）
    const usage1 = parseFloat(load[0]) / cores * 100;  // 1 分鐘瞬間（顯示用，供參考）

    return {
      load_1min: parseFloat(load[0]),
      load_5min: parseFloat(load[1]),
      load_15min: parseFloat(load[2]),
      cores,
      usage_percent: Math.round(usage5),         // 告警判斷用 5 分鐘
      usage_1min_percent: Math.round(usage1),    // 訊息顯示 1 分鐘供參考
      alert: usage5 > config.thresholds.cpu_usage_percent
    };
  },
  
  memory: () => {
    const meminfo = exec('cat /proc/meminfo');
    const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)[1]);
    const available = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)[1]);
    const used = total - available;
    const usagePercent = Math.round((used / total) * 100);
    
    return {
      total_mb: Math.round(total / 1024),
      used_mb: Math.round(used / 1024),
      available_mb: Math.round(available / 1024),
      usage_percent: usagePercent,
      alert: usagePercent > config.thresholds.memory_usage_percent
    };
  },
  
  processes: () => {
    const results = {};
    let hasAlert = false;
    const extraAlerts = [];

    config.processes.forEach(proc => {
      // 相容舊格式（字串）和新格式（物件）
      const procDef = typeof proc === 'string' ? { name: proc, type: 'ps' } : proc;
      const { name, type, restartAlertThreshold, memoryAlertMB } = procDef;

      let isRunning = false;

      if (type === 'systemd') {
        // 用 systemctl is-active 取代 ps grep（不受短暫重啟影響）
        const active = exec(`systemctl --user is-active ${name} 2>/dev/null`);
        isRunning = (active === 'active' || active === 'activating');
        results[name] = { running: isRunning, type: 'systemd' };

        // 重啟迴圈偵測
        if (restartAlertThreshold != null) {
          const nRestartsRaw = exec(`systemctl --user show ${name} --property=NRestarts 2>/dev/null`);
          const nRestarts = parseInt((nRestartsRaw.split('=')[1] || '0').trim());
          results[name].nRestarts = nRestarts;
          if (nRestarts > restartAlertThreshold) {
            extraAlerts.push({ type: 'restart_loop', service: name, count: nRestarts, severity: 'HIGH' });
          }
        }

        // 記憶體監控
        if (memoryAlertMB != null && isRunning) {
          const pid = exec(`systemctl --user show ${name} --property=MainPID --value 2>/dev/null`);
          if (pid && pid !== '0') {
            const vmRss = exec(`cat /proc/${pid}/status 2>/dev/null | grep VmRSS | awk '{print $2}'`);
            const memMB = Math.round(parseInt(vmRss || '0') / 1024);
            results[name].memMB = memMB;
            if (memMB > memoryAlertMB) {
              extraAlerts.push({ type: 'high_memory', service: name, memMB, threshold: memoryAlertMB, severity: 'HIGH' });
            }
          }
        }
      } else {
        // ps grep 方式（適用於 pm2 和一般進程）
        const count = parseInt(exec(`ps aux | grep "${name}" | grep -v grep | wc -l`));
        isRunning = count > 0;
        results[name] = { running: isRunning, count };
      }

      if (!isRunning) hasAlert = true;
    });

    return {
      processes: results,
      extraAlerts,
      alert: hasAlert || extraAlerts.length > 0
    };
  }
};

// 執行巡邏
function patrol() {
  const timestamp = new Date().toISOString();
  const results = {
    timestamp,
    checks: {},
    alerts: []
  };
  
  console.log(`[${timestamp}] 開始資安巡邏...`);
  
  config.monitors.forEach(monitor => {
    if (monitors[monitor]) {
      console.log(`  檢查 ${monitor}...`);
      const result = monitors[monitor]();
      results.checks[monitor] = result;
      
      if (result.alert) {
        results.alerts.push({
          type: monitor,
          severity: getSeverity(monitor, result),
          data: result
        });
      }
    }
  });
  
  // 儲存結果
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(results, null, 2));
  
  // 儲存歷史
  const historyFile = path.join(HISTORY_DIR, `${timestamp.split('T')[0]}.jsonl`);
  fs.appendFileSync(historyFile, JSON.stringify(results) + '\n');
  
  console.log(`✅ 巡邏完成。檢查項目：${config.monitors.length}，異常：${results.alerts.length}`);
  
  return results;
}

// 判斷嚴重程度
function getSeverity(type, result) {
  switch (type) {
    case 'firewall':
      return 'CRITICAL';
    case 'processes':
      return 'HIGH';
    case 'ssh':
      return result.failed_logins > 50 ? 'HIGH' : 'MEDIUM';
    case 'disk':
      return result.usage_percent > 95 ? 'CRITICAL' : 'HIGH';
    case 'memory':
    case 'cpu':
      return result.usage_percent > 95 ? 'HIGH' : 'MEDIUM';
    case 'updates':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
}

// 生成報告
function generateReport(results, mode = 'alert') {
  const lines = [];
  
  if (mode === 'daily') {
    lines.push('🛡️ 資安日報');
    lines.push(`📅 ${new Date(results.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
    lines.push('');
  }
  
  if (results.alerts.length > 0) {
    lines.push(`⚠️ ${results.alerts.length} 個異常`);
    lines.push('');
    
    results.alerts.forEach(alert => {
      const icon = alert.severity === 'CRITICAL' ? '🔴' : alert.severity === 'HIGH' ? '🟠' : '🟡';
      
      switch (alert.type) {
        case 'ssh':
          lines.push(`${icon} SSH | 失敗 ${alert.data.failed_logins} 次`);
          if (alert.data.top_failed_ips.length > 0) {
            alert.data.top_failed_ips.slice(0, 3).forEach(({ ip, count }) => {
              lines.push(`  ${ip}: ${count}`);
            });
          }
          break;
        case 'firewall':
          lines.push(`${icon} 防火牆 | 未啟動`);
          break;
        case 'disk':
          lines.push(`${icon} 磁碟 | ${alert.data.usage_percent}% (${alert.data.available} 可用)`);
          break;
        case 'cpu':
          lines.push(`${icon} CPU | ${alert.data.usage_percent}% (5min avg, 1min: ${alert.data.usage_1min_percent}%)`);

          break;
        case 'memory':
          lines.push(`${icon} RAM | ${alert.data.usage_percent}% (${alert.data.available_mb}MB 可用)`);
          break;
        case 'processes':
          Object.entries(alert.data.processes).forEach(([name, info]) => {
            if (!info.running) {
              lines.push(`${icon} Process | ${name} 未執行`);
            }
          });
          if (alert.data.extraAlerts) {
            alert.data.extraAlerts.forEach(ea => {
              if (ea.type === 'restart_loop') {
                lines.push(`${icon} Process | ${ea.service} 重啟迴圈 (${ea.count} 次)`);
              } else if (ea.type === 'high_memory') {
                lines.push(`${icon} Process | ${ea.service} 記憶體高 (${ea.memMB}MB > ${ea.threshold}MB)`);
              }
            });
          }
          break;
        case 'updates':
          lines.push(`${icon} 更新 | ${alert.data.security_updates} 個安全性更新`);
          if (alert.data.security_packages && alert.data.security_packages.length > 0) {
            lines.push(`  套件: ${alert.data.security_packages.join(', ')}`);
            lines.push(`  ⚠️ 需 root: sudo apt upgrade ${alert.data.security_packages.join(' ')}`);
          }
          break;
      }
    });
    lines.push('');
  } else if (mode === 'daily') {
    lines.push('✅ 系統正常');
    lines.push('');
  }
  
  if (mode === 'daily') {
    lines.push('📊 系統摘要');
    const stats = [];
    Object.entries(results.checks).forEach(([type, data]) => {
      switch (type) {
        case 'disk':
          stats.push(`磁碟 ${data.usage_percent}%`);
          break;
        case 'cpu':
          stats.push(`CPU ${data.usage_percent}%`);
          break;
        case 'memory':
          stats.push(`RAM ${data.usage_percent}%`);
          break;
        case 'processes':
          const runningCount = Object.values(data.processes).filter(p => p.running).length;
          stats.push(`Process ${runningCount}/${Object.keys(data.processes).length}`);
          break;
        case 'updates':
          if (data.security_updates > 0) {
            stats.push(`更新 ${data.security_updates}`);
          }
          break;
      }
    });
    lines.push(stats.join(' | '));
  }
  
  return lines.join('\n');
}

// LLM 分析（report mode 用，失敗不影響日報）
async function generateAiInsight(results) {
  try {
    const llmClient = require('../kanban-dashboard/server/services/llm-client');
    const summary = {
      alerts: results.alerts.length,
      ssh_failed: results.checks.ssh?.failed_logins || 0,
      disk: results.checks.disk?.usage_percent || 0,
      cpu: results.checks.cpu?.usage_percent || 0,
      memory: results.checks.memory?.usage_percent || 0,
      alertDetails: results.alerts.map(a => `${a.type}(${a.severity})`).join(', ') || '無'
    };
    const prompt = `VPS 資安巡邏摘要：SSH 失敗登入 ${summary.ssh_failed} 次，磁碟 ${summary.disk}%，CPU ${summary.cpu}%，RAM ${summary.memory}%，異常 ${summary.alerts} 項（${summary.alertDetails}）。請用繁體中文給出 1-2 句安全評估（50字以內）。`;
    const result = await llmClient.callLLM(prompt, {
      agentId: 'security-patrol',
      maxTokens: 150,
      source: 'security-patrol'
    });
    return result.text;
  } catch (err) {
    return null;
  }
}

// ── Memory Pipeline Health Check ─────────────────────────────────────────────

const HOME_DIR = process.env.HOME || '/home/clawbot';

const MEMORY_HEALTH_PATHS = {
  memory_dir:          path.join(HOME_DIR, 'clawd/memory'),
  knowledge_store:     path.join(HOME_DIR, 'clawd/agents/knowledge-digest/data/knowledge-store.jsonl'),
  openclaw_memory_md:  path.join(HOME_DIR, '.openclaw/MEMORY.md'),
  workspace_memory_md: path.join(HOME_DIR, 'clawd/MEMORY.md'),
  openclaw_config:     path.join(HOME_DIR, '.openclaw/openclaw.json'),
};

function checkMemoryHealth() {
  const now = Date.now();
  const checks = {};
  let overallSeverity = 'INFO';

  const escalate = (level) => {
    if (level === 'ERROR') overallSeverity = 'ERROR';
    else if (level === 'WARNING' && overallSeverity !== 'ERROR') overallSeverity = 'WARNING';
  };

  // ── check 1: daily_log ──────────────────────────────────────────────────────
  const dailyLogCheck = (() => {
    try {
      if (!fs.existsSync(MEMORY_HEALTH_PATHS.memory_dir)) {
        escalate('ERROR');
        return { latest_file: null, age_days: null, recent_files: [], status: 'ERROR' };
      }
      const all = fs.readdirSync(MEMORY_HEALTH_PATHS.memory_dir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort();
      if (all.length === 0) {
        escalate('WARNING');
        return { latest_file: null, age_days: null, recent_files: [], status: 'WARNING' };
      }
      const latest = all[all.length - 1];
      const latestPath = path.join(MEMORY_HEALTH_PATHS.memory_dir, latest);
      const mtime = fs.statSync(latestPath).mtime.getTime();
      const ageDays = Math.floor((now - mtime) / 86400000);
      const recentFiles = all.slice(-3).reverse();
      let status = 'OK';
      if (ageDays >= 5) { status = 'ERROR'; escalate('ERROR'); }
      else if (ageDays >= 2) { status = 'WARNING'; escalate('WARNING'); }
      return { latest_file: latest, age_days: ageDays, recent_files: recentFiles, status };
    } catch (e) {
      escalate('ERROR');
      return { latest_file: null, age_days: null, recent_files: [], status: 'ERROR' };
    }
  })();
  checks.daily_log = dailyLogCheck;

  // ── check 2: knowledge_digest ───────────────────────────────────────────────
  const kdCheck = (() => {
    if (!fs.existsSync(MEMORY_HEALTH_PATHS.knowledge_store)) {
      escalate('WARNING');
      return { entries_count: 0, latest_update: null, parse_errors: 0, status: 'WARNING' };
    }
    try {
      const lines = fs.readFileSync(MEMORY_HEALTH_PATHS.knowledge_store, 'utf8').split('\n');
      let count = 0;
      let parseErrors = 0;
      let latestUpdate = null;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          count++;
          const ts = entry.updated_at || entry.created_at || null;
          if (ts) {
            const t = new Date(ts).getTime();
            if (!isNaN(t) && (!latestUpdate || t > new Date(latestUpdate).getTime())) {
              latestUpdate = ts;
            }
          }
        } catch {
          parseErrors++;
        }
      }
      let status = 'OK';
      if (parseErrors > 0) { status = 'WARNING'; escalate('WARNING'); }
      if (count < 10) { status = 'WARNING'; escalate('WARNING'); }
      return { entries_count: count, latest_update: latestUpdate, parse_errors: parseErrors, status };
    } catch (e) {
      escalate('ERROR');
      return { entries_count: 0, latest_update: null, parse_errors: 0, status: 'ERROR' };
    }
  })();
  checks.knowledge_digest = kdCheck;

  // ── check 3: memory_md ──────────────────────────────────────────────────────
  const memMdCheck = (() => {
    const getBytes = (p) => {
      if (!fs.existsSync(p)) return null;
      return fs.statSync(p).size;
    };
    const ocBytes = getBytes(MEMORY_HEALTH_PATHS.openclaw_memory_md);
    const wsBytes = getBytes(MEMORY_HEALTH_PATHS.workspace_memory_md);
    let status = 'OK';
    if (ocBytes === null || wsBytes === null) { status = 'ERROR'; escalate('ERROR'); }
    else if (ocBytes === 0 || wsBytes === 0) { status = 'WARNING'; escalate('WARNING'); }
    return { openclaw_bytes: ocBytes, workspace_bytes: wsBytes, status };
  })();
  checks.memory_md = memMdCheck;

  // ── check 4: memory_search_paths ────────────────────────────────────────────
  const pathsCheck = (() => {
    const defaultResult = {
      configured: false, contains_workspace_memory: false,
      contains_memory_dir: false, expanded_paths: [], status: 'ERROR',
    };
    if (!fs.existsSync(MEMORY_HEALTH_PATHS.openclaw_config)) {
      escalate('ERROR');
      return defaultResult;
    }
    let ocConfig;
    try {
      ocConfig = JSON.parse(fs.readFileSync(MEMORY_HEALTH_PATHS.openclaw_config, 'utf8'));
    } catch {
      escalate('ERROR');
      return { ...defaultResult, status: 'ERROR' };
    }
    const rawPaths = ocConfig?.memorySearch?.paths ?? ocConfig?.agents?.defaults?.memorySearch?.paths;
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
      escalate('WARNING');
      return { configured: false, contains_workspace_memory: false, contains_memory_dir: false, expanded_paths: [], status: 'WARNING' };
    }
    // 展開 ~ 為實際 home 路徑
    const expanded = rawPaths.map(p => p.replace(/^~/, HOME_DIR));
    const wsMemMd = MEMORY_HEALTH_PATHS.workspace_memory_md;
    const memDir = MEMORY_HEALTH_PATHS.memory_dir;
    const containsWs = expanded.some(p => p === wsMemMd || p === wsMemMd + '/');
    const containsDir = expanded.some(p => p === memDir || p === memDir + '/');
    let status = 'OK';
    if (!containsWs) { status = 'WARNING'; escalate('WARNING'); }
    return { configured: true, contains_workspace_memory: containsWs, contains_memory_dir: containsDir, expanded_paths: expanded, status };
  })();
  checks.memory_search_paths = pathsCheck;

  return {
    report_version: '1',
    ok: true,
    severity: overallSeverity,
    timestamp: new Date().toISOString(),
    checked_paths: MEMORY_HEALTH_PATHS,
    checks,
  };
}

function formatMemoryHealthText(health) {
  const { severity, checks } = health;
  const icon = severity === 'ERROR' ? '🔴' : severity === 'WARNING' ? '🟡' : '✅';
  const lines = [`${icon} Memory Pipeline — ${severity}`];

  const dl = checks.daily_log;
  if (dl.status === 'OK') {
    lines.push(`  ✅ Daily log: ${dl.latest_file}（${dl.age_days}天前）`);
  } else if (dl.latest_file) {
    lines.push(`  ${dl.status === 'ERROR' ? '🔴' : '🟡'} Daily log: ${dl.latest_file}（${dl.age_days}天前）`);
  } else {
    lines.push(`  🔴 Daily log: 目錄不存在或無合法檔案`);
  }

  const kd = checks.knowledge_digest;
  const kdIcon = kd.status === 'OK' ? '✅' : kd.status === 'ERROR' ? '🔴' : '🟡';
  lines.push(`  ${kdIcon} Knowledge-digest: ${kd.entries_count} entries${kd.parse_errors > 0 ? `（${kd.parse_errors} parse errors）` : ''}`);

  const mm = checks.memory_md;
  if (mm.status === 'OK') {
    lines.push(`  ✅ MEMORY.md: openclaw ${mm.openclaw_bytes}B / workspace ${mm.workspace_bytes}B`);
  } else {
    const ocStr = mm.openclaw_bytes === null ? '❌不存在' : `${mm.openclaw_bytes}B`;
    const wsStr = mm.workspace_bytes === null ? '❌不存在' : `${mm.workspace_bytes}B`;
    lines.push(`  ${mm.status === 'ERROR' ? '🔴' : '🟡'} MEMORY.md: openclaw ${ocStr} / workspace ${wsStr}`);
  }

  const mp = checks.memory_search_paths;
  if (mp.status === 'OK') {
    lines.push(`  ✅ memorySearch.paths: 正確設定`);
  } else if (!mp.configured) {
    lines.push(`  🟡 memorySearch.paths: 空陣列或未設定`);
  } else if (!mp.contains_workspace_memory) {
    lines.push(`  🟡 memorySearch.paths: 未包含 workspace MEMORY.md`);
  }

  return lines.join('\n');
}

// 主程式
if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args[0] || 'patrol';

  (async () => {
  if (mode === 'patrol') {
    const results = patrol();

    // 推播由 patrol-wrapper.sh 負責（讀取 latest.json 中的 alerts）
    if (results.alerts.length > 0) {
      console.log(`⚠️  ${results.alerts.length} 個異常（見 data/runtime/latest.json）`);
    }
  } else if (mode === 'report') {
    const results = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
    const report = generateReport(results, 'daily');
    const aiInsight = await generateAiInsight(results);
    if (aiInsight) {
      console.log(report + '\n\n🤖 AI 評估：' + aiInsight);
    } else {
      console.log(report);
    }
  } else if (mode === 'status') {
    if (fs.existsSync(RUNTIME_PATH)) {
      const results = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
      console.log(`最後巡邏時間：${new Date(results.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
      console.log(`檢查項目：${Object.keys(results.checks).length}`);
      console.log(`異常數量：${results.alerts.length}`);
      if (results.alerts.length > 0) {
        console.log('\n異常清單：');
        results.alerts.forEach(alert => {
          console.log(`  - ${alert.type}: ${alert.severity}`);
        });
      }
    } else {
      console.log('尚未執行巡邏');
    }
  }
  })();
}

module.exports = { patrol, generateReport, checkMemoryHealth, formatMemoryHealthText };
