#!/usr/bin/env node
// 安全版基準測試：不重啟服務，只測量現有狀態

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const BENCHMARK_DIR = path.join(__dirname, '../data/benchmarks');

if (!fs.existsSync(BENCHMARK_DIR)) {
  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
}

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000, ...options }).trim();
  } catch (e) {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString();
}

class SafeBenchmarkRunner {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.service = config.services[serviceName];
    this.results = {
      service: serviceName,
      timestamp: timestamp(),
      tests: {}
    };
  }
  
  // 測試：健康檢查響應時間
  testHealthCheckTime() {
    if (!this.service.healthCheck) {
      return null;
    }
    
    console.log('  測試健康檢查響應時間...');
    
    const startTime = Date.now();
    
    if (this.service.healthCheck.script && this.service.path) {
      exec(`cd "${this.service.path}" && ${this.service.healthCheck.script}`);
    } else if (this.service.healthCheck.systemd && this.service.service) {
      exec(`systemctl --user is-active ${this.service.service}`);
    }
    
    const elapsed = Date.now() - startTime;
    
    return {
      metric: 'health_check_time_ms',
      value: elapsed,
      unit: 'ms',
      passed: elapsed < 1000
    };
  }
  
  // 測試：內存占用（當前狀態）
  testMemoryUsage() {
    if (!this.service.service) {
      return null;
    }
    
    console.log('  測試內存占用...');
    
    // 使用 CGroup 內存而非單一進程內存
    const memoryBytes = exec(`systemctl --user show ${this.service.service} -p MemoryCurrent --value`);
    if (!memoryBytes || memoryBytes === '[not set]') {
      return null;
    }
    
    const memoryMB = Math.round(parseInt(memoryBytes) / 1024 / 1024);
    
    return {
      metric: 'memory_usage_mb',
      value: memoryMB,
      unit: 'MB',
      passed: memoryMB < 600
    };
  }
  
  // 測試：CPU 使用率
  testCpuUsage() {
    if (!this.service.service) {
      return null;
    }
    
    console.log('  測試 CPU 使用率...');
    
    const pid = exec(`systemctl --user show ${this.service.service} -p MainPID --value`);
    if (!pid || pid === '0') {
      return null;
    }
    
    const cpu = exec(`ps -p ${pid} -o %cpu=`) || '0.0';
    
    return {
      metric: 'cpu_usage_percent',
      value: parseFloat(parseFloat(cpu).toFixed(2)),
      unit: '%',
      passed: parseFloat(cpu) < 50
    };
  }
  
  // 測試：服務運行時間
  testUptime() {
    if (!this.service.service) {
      return null;
    }
    
    console.log('  測試服務運行時間...');
    
    const uptimeStr = exec(`systemctl --user show ${this.service.service} -p ActiveEnterTimestamp --value`);
    if (!uptimeStr) {
      return null;
    }
    
    const startTime = new Date(uptimeStr).getTime();
    const now = Date.now();
    const uptimeSeconds = Math.floor((now - startTime) / 1000);
    
    return {
      metric: 'uptime_seconds',
      value: uptimeSeconds,
      unit: 'seconds',
      passed: true // 僅記錄
    };
  }
  
  // 測試：檔案數量
  testFileCount() {
    if (!this.service.path) {
      return null;
    }
    
    console.log('  測試檔案數量...');
    
    const count = exec(`find "${this.service.path}" -type f | wc -l`) || '0';
    
    return {
      metric: 'file_count',
      value: parseInt(count),
      unit: 'files',
      passed: true
    };
  }
  
  // 測試：磁盤占用
  testDiskUsage() {
    if (!this.service.path) {
      return null;
    }
    
    console.log('  測試磁盤占用...');
    
    const size = exec(`du -sm "${this.service.path}" | cut -f1`) || '0';
    
    return {
      metric: 'disk_usage_mb',
      value: parseInt(size),
      unit: 'MB',
      passed: parseInt(size) < 1000
    };
  }
  
  // 執行所有測試
  runAll() {
    console.log(`\n🔬 執行安全基準測試：${this.serviceName}`);
    
    const tests = [
      this.testHealthCheckTime(),
      this.testMemoryUsage(),
      this.testCpuUsage(),
      this.testUptime(),
      this.testFileCount(),
      this.testDiskUsage()
    ];
    
    tests.forEach(test => {
      if (test) {
        this.results.tests[test.metric] = {
          value: test.value,
          unit: test.unit,
          passed: test.passed
        };
      }
    });
    
    const passedTests = Object.values(this.results.tests).filter(t => t.passed).length;
    const totalTests = Object.values(this.results.tests).filter(t => t.passed !== undefined).length;
    
    this.results.score = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
    this.results.passed_tests = passedTests;
    this.results.total_tests = totalTests;
    
    console.log(`✅ 測試完成：${passedTests}/${totalTests} 通過 (${this.results.score}分)`);
    
    return this.results;
  }
  
  save() {
    const filename = path.join(BENCHMARK_DIR, `${this.serviceName}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
    return filename;
  }
  
  compare() {
    const files = fs.readdirSync(BENCHMARK_DIR)
      .filter(f => f.startsWith(`${this.serviceName}-`) && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length < 2) {
      return { has_baseline: false };
    }
    
    const baselineFile = path.join(BENCHMARK_DIR, files[1]);
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    
    const comparison = {
      has_baseline: true,
      baseline_timestamp: baseline.timestamp,
      changes: {}
    };
    
    Object.keys(this.results.tests).forEach(metric => {
      if (baseline.tests[metric]) {
        const current = this.results.tests[metric].value;
        const prev = baseline.tests[metric].value;
        const change = current - prev;
        const changePercent = prev !== 0 ? ((change / prev) * 100).toFixed(2) : 0;
        
        comparison.changes[metric] = {
          current,
          previous: prev,
          change,
          change_percent: parseFloat(changePercent),
          regression: this.isRegression(metric, changePercent)
        };
      }
    });
    
    return comparison;
  }
  
  isRegression(metric, changePercent) {
    const thresholds = {
      'health_check_time_ms': 50,
      'memory_usage_mb': 30,
      'cpu_usage_percent': 50,
      'disk_usage_mb': 50
    };
    
    const threshold = thresholds[metric] || 100;
    return changePercent > threshold;
  }
}

function formatComparison(serviceName, comparison) {
  if (!comparison.has_baseline) {
    return '📊 首次測試，無歷史數據比較';
  }
  
  const lines = [`\n📊 性能比較：${serviceName}\n`];
  
  let hasRegression = false;
  
  Object.entries(comparison.changes).forEach(([metric, data]) => {
    const icon = data.regression ? '🔴' : data.change_percent < -10 ? '🟢' : '⚪';
    const direction = data.change > 0 ? '↑' : '↓';
    
    const names = {
      'health_check_time_ms': '健康檢查',
      'memory_usage_mb': '內存',
      'cpu_usage_percent': 'CPU',
      'disk_usage_mb': '磁盤',
      'file_count': '檔案',
      'uptime_seconds': '運行時間'
    };
    
    const name = names[metric] || metric;
    
    lines.push(`${icon} ${name}: ${data.current} ${direction} ${Math.abs(data.change_percent)}%`);
    
    if (data.regression) {
      hasRegression = true;
    }
  });
  
  if (hasRegression) {
    lines.push('\n⚠️ 檢測到性能退化');
  }
  
  return lines.join('\n');
}

// CLI
if (require.main === module) {
  const serviceName = process.argv[2];
  
  if (!serviceName) {
    console.log('用法: node benchmark-safe.js <service>');
    process.exit(1);
  }
  
  if (!config.services[serviceName]) {
    console.error(`❌ 服務不存在：${serviceName}`);
    process.exit(1);
  }
  
  const benchmark = new SafeBenchmarkRunner(serviceName);
  const results = benchmark.runAll();
  
  const filename = benchmark.save();
  console.log(`\n💾 結果：${filename}`);
  
  const comparison = benchmark.compare();
  console.log(formatComparison(serviceName, comparison));
  
  console.log('\n--- JSON ---');
  console.log(JSON.stringify({ results, comparison }, null, 2));
}

module.exports = { SafeBenchmarkRunner, formatComparison };
