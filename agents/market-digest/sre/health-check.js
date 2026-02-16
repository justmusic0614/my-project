/**
 * Health Check Module
 * Monitors system health: disk space, memory, process status, API endpoints
 */

const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const path = require('path');

class HealthChecker {
  constructor(options = {}) {
    this.thresholds = {
      diskFreePercent: options.diskFreePercent || 10,
      memoryFreePercent: options.memoryFreePercent || 15,
      diskFreeMB: options.diskFreeMB || 500,
      memoryFreeMB: options.memoryFreeMB || 200,
      ...options.thresholds
    };

    this.agentDir = options.agentDir || process.cwd();
    this.healthLogPath = path.join(this.agentDir, 'logs', 'health-check.json');

    // Health check history (keep last 100)
    this.history = [];
    this.loadHistory();
  }

  /**
   * Run all health checks
   */
  async checkAll() {
    const checks = {
      timestamp: new Date().toISOString(),
      disk: this.checkDiskSpace(),
      memory: this.checkMemory(),
      process: this.checkProcess(),
      dataFiles: this.checkDataFiles(),
      logs: this.checkLogs()
    };

    const status = this.evaluateOverallStatus(checks);

    const result = {
      ...checks,
      status,
      summary: this.generateSummary(checks, status)
    };

    this.recordCheck(result);
    return result;
  }

  /**
   * Check disk space
   */
  checkDiskSpace() {
    try {
      const agentPath = this.agentDir;

      // Use df command to check disk space
      const dfOutput = execSync(`df -k "${agentPath}"`, { encoding: 'utf-8' });
      const lines = dfOutput.trim().split('\n');
      const dataLine = lines[lines.length - 1];
      const parts = dataLine.split(/\s+/);

      const totalKB = parseInt(parts[1]) || 0;
      const usedKB = parseInt(parts[2]) || 0;
      const availKB = parseInt(parts[3]) || 0;
      const usePercent = parseInt(parts[4]) || 0;

      const totalMB = Math.round(totalKB / 1024);
      const usedMB = Math.round(usedKB / 1024);
      const freeMB = Math.round(availKB / 1024);
      const freePercent = Math.round((availKB / totalKB) * 100);

      const status = this.evaluateDiskStatus(freeMB, freePercent);

      return {
        totalMB,
        usedMB,
        freeMB,
        freePercent,
        usePercent,
        status,
        message: `Disk: ${freeMB}MB free (${freePercent}%)`
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        message: 'Failed to check disk space'
      };
    }
  }

  /**
   * Check memory usage
   */
  checkMemory() {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      const totalMB = Math.round(totalMem / 1024 / 1024);
      const freeMB = Math.round(freeMem / 1024 / 1024);
      const usedMB = Math.round(usedMem / 1024 / 1024);
      const freePercent = Math.round((freeMem / totalMem) * 100);
      const usePercent = Math.round((usedMem / totalMem) * 100);

      const status = this.evaluateMemoryStatus(freeMB, freePercent);

      return {
        totalMB,
        usedMB,
        freeMB,
        freePercent,
        usePercent,
        status,
        message: `Memory: ${freeMB}MB free (${freePercent}%)`
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        message: 'Failed to check memory'
      };
    }
  }

  /**
   * Check if market-digest process is running
   */
  checkProcess() {
    try {
      // Check if any market-digest related process is running
      const psOutput = execSync('ps aux | grep -E "market-digest|agent.js" | grep -v grep', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const processes = psOutput.trim().split('\n').filter(line => line.length > 0);
      const isRunning = processes.length > 0;

      return {
        status: isRunning ? 'healthy' : 'info',
        isRunning,
        processCount: processes.length,
        message: isRunning
          ? `${processes.length} market-digest process(es) running`
          : 'No market-digest process detected (may be normal if run on-demand)'
      };
    } catch (error) {
      // ps command returns non-zero if no matches, which is expected
      return {
        status: 'info',
        isRunning: false,
        processCount: 0,
        message: 'No market-digest process detected (may be normal if run on-demand)'
      };
    }
  }

  /**
   * Check data files integrity
   */
  checkDataFiles() {
    try {
      const dataDir = path.join(this.agentDir, 'data');

      if (!fs.existsSync(dataDir)) {
        return {
          status: 'warning',
          message: 'Data directory not found'
        };
      }

      const checkDirs = [
        'news-collect',
        'daily-brief',
        'watchlist.json'
      ];

      const results = {};
      let hasIssue = false;

      for (const dir of checkDirs) {
        const fullPath = path.join(dataDir, dir);
        const exists = fs.existsSync(fullPath);
        results[dir] = exists ? 'ok' : 'missing';
        if (!exists) hasIssue = true;
      }

      // Check if watchlist.json is valid JSON
      const watchlistPath = path.join(dataDir, 'watchlist.json');
      if (fs.existsSync(watchlistPath)) {
        try {
          const content = fs.readFileSync(watchlistPath, 'utf-8');
          JSON.parse(content);
          results['watchlist.json'] = 'ok';
        } catch (e) {
          results['watchlist.json'] = 'invalid';
          hasIssue = true;
        }
      }

      return {
        status: hasIssue ? 'warning' : 'healthy',
        results,
        message: hasIssue
          ? 'Some data files are missing or invalid'
          : 'All critical data files present'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        message: 'Failed to check data files'
      };
    }
  }

  /**
   * Check logs directory
   */
  checkLogs() {
    try {
      const logsDir = path.join(this.agentDir, 'logs');

      if (!fs.existsSync(logsDir)) {
        return {
          status: 'info',
          message: 'Logs directory not found (will be created on first run)'
        };
      }

      const files = fs.readdirSync(logsDir);
      const logFiles = files.filter(f => f.endsWith('.log') || f.endsWith('.json'));

      // Calculate total log size
      let totalSize = 0;
      for (const file of logFiles) {
        const stat = fs.statSync(path.join(logsDir, file));
        totalSize += stat.size;
      }

      const totalSizeMB = Math.round(totalSize / 1024 / 1024 * 10) / 10;

      return {
        status: totalSizeMB > 100 ? 'warning' : 'healthy',
        logFileCount: logFiles.length,
        totalSizeMB,
        message: totalSizeMB > 100
          ? `Logs size: ${totalSizeMB}MB (consider cleanup)`
          : `Logs size: ${totalSizeMB}MB (${logFiles.length} files)`
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        message: 'Failed to check logs'
      };
    }
  }

  /**
   * Evaluate disk status
   */
  evaluateDiskStatus(freeMB, freePercent) {
    if (freeMB < this.thresholds.diskFreeMB || freePercent < this.thresholds.diskFreePercent) {
      return 'critical';
    }
    if (freeMB < this.thresholds.diskFreeMB * 2 || freePercent < this.thresholds.diskFreePercent * 2) {
      return 'warning';
    }
    return 'healthy';
  }

  /**
   * Evaluate memory status
   */
  evaluateMemoryStatus(freeMB, freePercent) {
    if (freeMB < this.thresholds.memoryFreeMB || freePercent < this.thresholds.memoryFreePercent) {
      return 'critical';
    }
    if (freeMB < this.thresholds.memoryFreeMB * 2 || freePercent < this.thresholds.memoryFreePercent * 2) {
      return 'warning';
    }
    return 'healthy';
  }

  /**
   * Evaluate overall status
   */
  evaluateOverallStatus(checks) {
    const statuses = [
      checks.disk.status,
      checks.memory.status,
      checks.dataFiles.status,
      checks.logs.status
      // Process status is info/healthy, not critical
    ];

    if (statuses.includes('critical')) return 'critical';
    if (statuses.includes('error')) return 'error';
    if (statuses.includes('warning')) return 'warning';
    return 'healthy';
  }

  /**
   * Generate summary message
   */
  generateSummary(checks, status) {
    const messages = [];

    if (status === 'healthy') {
      messages.push('✅ All systems healthy');
    } else if (status === 'warning') {
      messages.push('⚠️  Warning: some checks need attention');
    } else if (status === 'critical') {
      messages.push('🚨 Critical: immediate action required');
    } else {
      messages.push('❌ Error: health check failed');
    }

    // Add specific issues
    if (checks.disk.status !== 'healthy') {
      messages.push(`  - Disk: ${checks.disk.message}`);
    }
    if (checks.memory.status !== 'healthy') {
      messages.push(`  - Memory: ${checks.memory.message}`);
    }
    if (checks.dataFiles.status !== 'healthy') {
      messages.push(`  - Data: ${checks.dataFiles.message}`);
    }
    if (checks.logs.status === 'warning') {
      messages.push(`  - Logs: ${checks.logs.message}`);
    }

    return messages.join('\n');
  }

  /**
   * Record health check to history
   */
  recordCheck(result) {
    this.history.push(result);

    // Keep only last 100 checks
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    this.saveHistory();
  }

  /**
   * Load history from file
   */
  loadHistory() {
    try {
      if (fs.existsSync(this.healthLogPath)) {
        const content = fs.readFileSync(this.healthLogPath, 'utf-8');
        const data = JSON.parse(content);
        this.history = data.checks || [];
      }
    } catch (error) {
      console.error('Failed to load health check history:', error.message);
      this.history = [];
    }
  }

  /**
   * Save history to file
   */
  saveHistory() {
    try {
      const logsDir = path.dirname(this.healthLogPath);
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const data = {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        checks: this.history
      };

      fs.writeFileSync(this.healthLogPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save health check history:', error.message);
    }
  }

  /**
   * Get statistics from history
   */
  getStats(timeWindowMs = 3600000) {
    const cutoff = Date.now() - timeWindowMs;
    const recentChecks = this.history.filter(check =>
      new Date(check.timestamp).getTime() > cutoff
    );

    if (recentChecks.length === 0) {
      return {
        count: 0,
        message: 'No recent health checks'
      };
    }

    const statusCounts = {
      healthy: 0,
      warning: 0,
      critical: 0,
      error: 0
    };

    recentChecks.forEach(check => {
      statusCounts[check.status] = (statusCounts[check.status] || 0) + 1;
    });

    const healthPercent = Math.round((statusCounts.healthy / recentChecks.length) * 100);

    return {
      count: recentChecks.length,
      timeWindowHours: timeWindowMs / 3600000,
      statusCounts,
      healthPercent,
      lastCheck: recentChecks[recentChecks.length - 1]
    };
  }
}

// Export singleton instance
let instance = null;

function getHealthChecker(options) {
  if (!instance) {
    instance = new HealthChecker(options);
  }
  return instance;
}

// CLI interface
if (require.main === module) {
  const checker = getHealthChecker();

  checker.checkAll().then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('Market Digest - Health Check Report');
    console.log('='.repeat(60));
    console.log(`Timestamp: ${result.timestamp}`);
    console.log(`Overall Status: ${result.status.toUpperCase()}`);
    console.log('='.repeat(60));

    console.log('\n📊 Disk Space:');
    console.log(`   Status: ${result.disk.status}`);
    console.log(`   ${result.disk.message}`);
    console.log(`   Total: ${result.disk.totalMB}MB | Used: ${result.disk.usedMB}MB | Free: ${result.disk.freeMB}MB`);

    console.log('\n💾 Memory:');
    console.log(`   Status: ${result.memory.status}`);
    console.log(`   ${result.memory.message}`);
    console.log(`   Total: ${result.memory.totalMB}MB | Used: ${result.memory.usedMB}MB | Free: ${result.memory.freeMB}MB`);

    console.log('\n⚙️  Process:');
    console.log(`   Status: ${result.process.status}`);
    console.log(`   ${result.process.message}`);

    console.log('\n📁 Data Files:');
    console.log(`   Status: ${result.dataFiles.status}`);
    console.log(`   ${result.dataFiles.message}`);

    console.log('\n📝 Logs:');
    console.log(`   Status: ${result.logs.status}`);
    console.log(`   ${result.logs.message}`);

    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log(result.summary);
    console.log('='.repeat(60) + '\n');

    // Exit with appropriate code
    const exitCode = result.status === 'healthy' ? 0 : result.status === 'warning' ? 1 : 2;
    process.exit(exitCode);
  }).catch(error => {
    console.error('❌ Health check failed:', error);
    process.exit(2);
  });
}

module.exports = { HealthChecker, getHealthChecker };
