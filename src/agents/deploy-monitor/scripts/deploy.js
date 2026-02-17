#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DATA_DIR = path.join(__dirname, '../data');
const BACKUP_DIR = path.join(__dirname, '../backups');
const LOG_DIR = path.join(__dirname, '../logs');

// 确保目录存在
[DATA_DIR, BACKUP_DIR, LOG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 读取配置
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// 执行命令
function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...options }).trim();
  } catch (e) {
    if (options.ignoreError) {
      return null;
    }
    throw new Error(`Command failed: ${cmd}\n${e.message}`);
  }
}

// 记录日志
function log(message, service = 'system') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${service}] ${message}`;
  console.log(logLine);
  
  const logFile = path.join(LOG_DIR, `${service}.log`);
  fs.appendFileSync(logFile, logLine + '\n');
}

// 备份服务
function backup(serviceName) {
  const service = config.services[serviceName];
  
  if (!service.path) {
    log('无需备份（systemd服务）', serviceName);
    return null;
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${serviceName}-${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  
  log('开始备份...', serviceName);
  
  // 备份目录
  exec(`cp -r "${service.path}" "${backupPath}"`);
  
  // 如果是 git repo，记录当前 commit
  if (service.git) {
    const commit = exec(`cd "${service.path}" && git rev-parse HEAD`, { ignoreError: true });
    if (commit) {
      fs.writeFileSync(path.join(backupPath, '.backup-commit'), commit);
    }
  }
  
  log(`✅ 备份完成：${backupName}`, serviceName);
  
  // 清理旧备份
  cleanOldBackups(serviceName);
  
  return backupPath;
}

// 清理旧备份
function cleanOldBackups(serviceName) {
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(`${serviceName}-`))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
    }))
    .sort((a, b) => b.time - a.time);
  
  // 保留最近 N 个
  const toDelete = backups.slice(config.backup.keep);
  toDelete.forEach(backup => {
    exec(`rm -rf "${backup.path}"`);
    log(`🗑️ 删除旧备份：${backup.name}`, serviceName);
  });
}

// 部署服务
async function deploy(serviceName, options = {}) {
  const service = config.services[serviceName];
  
  if (!service) {
    throw new Error(`服务不存在：${serviceName}`);
  }
  
  log('🚀 开始部署...', serviceName);
  
  // 0. 部署前基准测试（可选）
  let benchmarkBefore = null;
  if (options.benchmark) {
    log('运行部署前基准测试...', serviceName);
    try {
      const BenchmarkRunner = require('./benchmark');
      const benchmark = new BenchmarkRunner.BenchmarkRunner(serviceName);
      benchmarkBefore = benchmark.runAll();
      benchmark.save();
    } catch (e) {
      log(`⚠️ 基准测试失败：${e.message}`, serviceName);
    }
  }
  
  // 1. 备份
  if (options.backup !== false && config.backup.enabled) {
    backup(serviceName);
  }
  
  // 2. Git pull
  if (service.git && service.path) {
    log('更新代码...', serviceName);
    try {
      const output = exec(`cd "${service.path}" && git pull`);
      log(output, serviceName);
    } catch (e) {
      log(`❌ Git pull 失败：${e.message}`, serviceName);
      throw e;
    }
  }
  
  // 3. 安装依赖
  if (service.npm && service.path) {
    log('安装依赖...', serviceName);
    exec(`cd "${service.path}" && npm install --production`);
  }
  
  // 4. 重启服务
  if (service.service) {
    log('重启服务...', serviceName);
    exec(`systemctl --user restart ${service.service}`);
    
    // 等待服务启动
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 检查状态
    const status = exec(`systemctl --user is-active ${service.service}`, { ignoreError: true });
    if (status === 'active') {
      log('✅ 服务已启动', serviceName);
    } else {
      throw new Error(`服务启动失败：${status}`);
    }
  }
  
  // 5. 健康检查
  const health = checkHealth(serviceName);
  if (!health.healthy) {
    log(`⚠️ 健康检查失败：${health.message}`, serviceName);
  } else {
    log('✅ 健康检查通过', serviceName);
  }
  
  // 6. 部署后基准测试（可选）
  let benchmarkAfter = null;
  let benchmarkComparison = null;
  if (options.benchmark) {
    log('运行部署后基准测试...', serviceName);
    try {
      const BenchmarkRunner = require('./benchmark');
      const benchmark = new BenchmarkRunner.BenchmarkRunner(serviceName);
      benchmarkAfter = benchmark.runAll();
      benchmark.save();
      benchmarkComparison = benchmark.compare();
      
      // 检查性能退化
      if (benchmarkComparison.has_baseline) {
        const hasRegression = Object.values(benchmarkComparison.changes).some(c => c.regression);
        if (hasRegression) {
          log('⚠️ 检测到性能退化！', serviceName);
        }
      }
    } catch (e) {
      log(`⚠️ 基准测试失败：${e.message}`, serviceName);
    }
  }
  
  log('🎉 部署完成', serviceName);
  
  return {
    success: true,
    service: serviceName,
    health,
    benchmark: benchmarkAfter ? {
      results: benchmarkAfter,
      comparison: benchmarkComparison
    } : null
  };
}

// 健康检查
function checkHealth(serviceName) {
  const service = config.services[serviceName];
  
  if (!service) {
    return { healthy: false, message: '服务不存在' };
  }
  
  const result = {
    healthy: true,
    service: serviceName,
    type: service.type,
    checks: {}
  };
  
  // Systemd 服务检查（带重试机制）
  if (service.service) {
    let status = null;
    let retries = 3;
    
    // 重试机制：避免瞬时状态导致误报
    for (let i = 0; i < retries; i++) {
      status = exec(`systemctl --user is-active ${service.service}`, { ignoreError: true });
      if (status === 'active') {
        break; // 检测到活动状态，停止重试
      }
      if (i < retries - 1) {
        // 等待 500ms 后重试
        execSync('sleep 0.5');
      }
    }
    
    const uptime = exec(`systemctl --user show ${service.service} -p ActiveEnterTimestamp --value`, { ignoreError: true });
    
    result.checks.systemd = {
      active: status === 'active',
      status,
      uptime
    };
    
    if (status !== 'active') {
      result.healthy = false;
      result.message = `systemd服务未运行：${status}`;
    }
  }
  
  // 自定义健康检查
  if (service.healthCheck) {
    if (service.healthCheck.systemd) {
      // 已在上面检查
    } else if (service.healthCheck.script && service.path) {
      try {
        const output = exec(`cd "${service.path}" && ${service.healthCheck.script}`, { ignoreError: true });
        result.checks.custom = {
          success: output !== null,
          output: output || 'Script failed'
        };
      } catch (e) {
        result.checks.custom = {
          success: false,
          error: e.message
        };
      }
    }
  }
  
  return result;
}

// 查看日志
function viewLogs(serviceName, options = {}) {
  const service = config.services[serviceName];
  
  if (!service) {
    throw new Error(`服务不存在：${serviceName}`);
  }
  
  const lines = options.lines || 50;
  let logs = '';
  
  // Systemd 日志
  if (service.service) {
    const cmd = `journalctl --user -u ${service.service} -n ${lines} --no-pager`;
    logs = exec(cmd);
  }
  
  // 自定义日志
  const logFile = path.join(LOG_DIR, `${serviceName}.log`);
  if (fs.existsSync(logFile)) {
    const customLogs = exec(`tail -n ${lines} "${logFile}"`);
    logs += '\n\n=== Deploy Monitor Logs ===\n' + customLogs;
  }
  
  // 过滤错误
  if (options.error) {
    logs = logs.split('\n')
      .filter(line => /error|fail|exception|fatal/i.test(line))
      .join('\n');
  }
  
  // 关键字搜寻
  if (options.grep) {
    logs = logs.split('\n')
      .filter(line => line.includes(options.grep))
      .join('\n');
  }
  
  return logs;
}

// 回滚
function rollback(serviceName, options = {}) {
  const service = config.services[serviceName];
  
  if (!service) {
    throw new Error(`服务不存在：${serviceName}`);
  }
  
  log('🔄 开始回滚...', serviceName);
  
  // 查找最近的备份
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(`${serviceName}-`))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
    }))
    .sort((a, b) => b.time - a.time);
  
  if (backups.length === 0) {
    throw new Error('没有可用的备份');
  }
  
  const latestBackup = backups[0];
  log(`使用备份：${latestBackup.name}`, serviceName);
  
  // 备份当前状态
  log('备份当前状态...', serviceName);
  backup(serviceName);
  
  // 恢复备份
  log('恢复备份...', serviceName);
  if (service.path) {
    exec(`rm -rf "${service.path}"`);
    exec(`cp -r "${latestBackup.path}" "${service.path}"`);
  }
  
  // 重启服务
  if (service.service) {
    log('重启服务...', serviceName);
    exec(`systemctl --user restart ${service.service}`);
  }
  
  log('✅ 回滚完成', serviceName);
  
  return {
    success: true,
    backup: latestBackup.name
  };
}

// 所有服务健康状态
function healthAll() {
  const results = {};
  
  Object.keys(config.services).forEach(serviceName => {
    results[serviceName] = checkHealth(serviceName);
  });
  
  return results;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const serviceName = args[1];
  
  try {
    switch (command) {
      case 'deploy':
        if (!serviceName) {
          console.error('用法: node deploy.js deploy <service> [--no-backup]');
          process.exit(1);
        }
        const deployOptions = {
          backup: !args.includes('--no-backup')
        };
        deploy(serviceName, deployOptions).then(result => {
          console.log(JSON.stringify(result, null, 2));
        });
        break;
        
      case 'health':
        if (serviceName) {
          const health = checkHealth(serviceName);
          console.log(JSON.stringify(health, null, 2));
        } else {
          const allHealth = healthAll();
          console.log(JSON.stringify(allHealth, null, 2));
        }
        break;
        
      case 'logs':
        if (!serviceName) {
          console.error('用法: node deploy.js logs <service> [--lines N] [--error] [--grep keyword]');
          process.exit(1);
        }
        const logsOptions = {
          lines: parseInt(args.find(a => a.startsWith('--lines'))?.split('=')[1]) || 50,
          error: args.includes('--error'),
          grep: args.find(a => a.startsWith('--grep'))?.split('=')[1]
        };
        const logs = viewLogs(serviceName, logsOptions);
        console.log(logs);
        break;
        
      case 'rollback':
        if (!serviceName) {
          console.error('用法: node deploy.js rollback <service>');
          process.exit(1);
        }
        const rollbackResult = rollback(serviceName);
        console.log(JSON.stringify(rollbackResult, null, 2));
        break;
        
      default:
        console.log(`
Deploy & Monitor Agent

用法：
  node deploy.js deploy <service> [--no-backup]
  node deploy.js health [service]
  node deploy.js logs <service> [--lines=N] [--error] [--grep=keyword]
  node deploy.js rollback <service>

可用服务：
${Object.keys(config.services).map(s => `  - ${s}`).join('\n')}
        `);
    }
  } catch (e) {
    console.error(`❌ 错误：${e.message}`);
    process.exit(1);
  }
}

module.exports = { deploy, checkHealth, viewLogs, rollback, healthAll };
