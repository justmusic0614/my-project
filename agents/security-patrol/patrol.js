#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const RUNTIME_PATH = path.join(__dirname, 'data/runtime/latest.json');
const HISTORY_DIR = path.join(__dirname, 'data/history');

// 讀取設定
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// 執行系統指令並回傳輸出
function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
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
    const updates = exec('apt list --upgradable 2>/dev/null | grep -v "Listing" | wc -l');
    const securityUpdates = exec('apt list --upgradable 2>/dev/null | grep -i security | wc -l');
    
    return {
      total_updates: parseInt(updates),
      security_updates: parseInt(securityUpdates),
      alert: parseInt(securityUpdates) > 0
    };
  },
  
  firewall: () => {
    const ufwInstalled = exec('which ufw 2>/dev/null').length > 0;
    
    if (!ufwInstalled) {
      // ufw 未安裝
      return {
        active: false,
        status: 'ufw not installed',
        firewall_type: 'none',
        alert: false,  // 降低為不警報（可能是雲端服務商層級防火牆）
        note: 'ufw 未安裝，假設使用雲端服務商防火牆'
      };
    }
    
    const status = exec('ufw status 2>/dev/null || echo "permission denied"');
    
    if (status.includes('permission denied') || status.includes('ERROR')) {
      // 權限不足，無法檢測
      return {
        active: null,
        status: 'unable to check (permission denied)',
        firewall_type: 'ufw',
        alert: false,  // 不警報（無法確定）
        note: '需要 sudo 權限才能檢測 ufw 狀態'
      };
    }
    
    const active = status.includes('Status: active');
    
    return {
      active,
      status: status.split('\n').slice(0, 10).join('\n'),
      firewall_type: 'ufw',
      alert: !active
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
    const usage = parseFloat(load[0]) / cores * 100;
    
    return {
      load_1min: parseFloat(load[0]),
      load_5min: parseFloat(load[1]),
      load_15min: parseFloat(load[2]),
      cores,
      usage_percent: Math.round(usage),
      alert: usage > config.thresholds.cpu_usage_percent
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
    
    config.processes.forEach(processName => {
      const count = exec(`ps aux | grep "${processName}" | grep -v grep | wc -l`);
      const isRunning = parseInt(count) > 0;
      results[processName] = {
        running: isRunning,
        count: parseInt(count)
      };
      if (!isRunning) hasAlert = true;
    });
    
    return {
      processes: results,
      alert: hasAlert
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
    lines.push('🛡️ **資安日報**');
    lines.push(`📅 ${new Date(results.timestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
    lines.push('');
  }
  
  if (results.alerts.length > 0) {
    lines.push(`⚠️ **發現 ${results.alerts.length} 個異常**`);
    lines.push('');
    
    results.alerts.forEach(alert => {
      const icon = alert.severity === 'CRITICAL' ? '🔴' : alert.severity === 'HIGH' ? '🟠' : '🟡';
      lines.push(`${icon} **${alert.type.toUpperCase()}** [${alert.severity}]`);
      
      switch (alert.type) {
        case 'ssh':
          lines.push(`  失敗登入：${alert.data.failed_logins} 次`);
          if (alert.data.top_failed_ips.length > 0) {
            lines.push(`  Top 失敗 IP：`);
            alert.data.top_failed_ips.forEach(({ ip, count }) => {
              lines.push(`    - ${ip}: ${count} 次`);
            });
          }
          break;
        case 'firewall':
          lines.push(`  防火牆未啟動`);
          break;
        case 'disk':
          lines.push(`  磁碟使用率：${alert.data.usage_percent}% (${alert.data.used}/${alert.data.total})`);
          break;
        case 'cpu':
          lines.push(`  CPU 使用率：${alert.data.usage_percent}% (load: ${alert.data.load_1min})`);
          break;
        case 'memory':
          lines.push(`  Memory 使用率：${alert.data.usage_percent}% (${alert.data.used_mb}MB/${alert.data.total_mb}MB)`);
          break;
        case 'processes':
          Object.entries(alert.data.processes).forEach(([name, info]) => {
            if (!info.running) {
              lines.push(`  Process 未執行：${name}`);
            }
          });
          break;
        case 'updates':
          lines.push(`  安全性更新：${alert.data.security_updates} 個`);
          break;
      }
      lines.push('');
    });
  } else if (mode === 'daily') {
    lines.push('✅ **系統狀態正常**');
    lines.push('');
  }
  
  if (mode === 'daily') {
    lines.push('📊 **系統摘要**');
    Object.entries(results.checks).forEach(([type, data]) => {
      switch (type) {
        case 'ssh':
          lines.push(`  SSH：成功 ${data.success_logins} / 失敗 ${data.failed_logins}`);
          break;
        case 'disk':
          lines.push(`  磁碟：${data.usage_percent}% (可用 ${data.available})`);
          break;
        case 'cpu':
          lines.push(`  CPU：${data.usage_percent}% (load: ${data.load_1min})`);
          break;
        case 'memory':
          lines.push(`  Memory：${data.usage_percent}% (可用 ${data.available_mb}MB)`);
          break;
        case 'updates':
          lines.push(`  更新：${data.total_updates} 個 (安全性 ${data.security_updates} 個)`);
          break;
        case 'firewall':
          lines.push(`  防火牆：${data.active ? '啟動' : '未啟動'} (${data.firewall_type})`);
          break;
        case 'processes':
          const runningCount = Object.values(data.processes).filter(p => p.running).length;
          lines.push(`  Processes：${runningCount}/${Object.keys(data.processes).length} 執行中`);
          break;
      }
    });
  }
  
  return lines.join('\n');
}

// 主程式
if (require.main === module) {
  const args = process.argv.slice(2);
  const mode = args[0] || 'patrol';
  
  if (mode === 'patrol') {
    const results = patrol();
    
    // 如果有異常且啟用即時警報，推播
    if (results.alerts.length > 0 && config.telegram.enable_instant_alerts) {
      const report = generateReport(results, 'alert');
      console.log('\n--- 警報報告 ---\n' + report);
      // TODO: 推播到 Telegram（需要整合 Clawdbot message tool）
    }
  } else if (mode === 'report') {
    const results = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
    const report = generateReport(results, 'daily');
    console.log(report);
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
}

module.exports = { patrol, generateReport };
