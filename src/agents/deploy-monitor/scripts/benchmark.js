#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const BENCHMARK_DIR = path.join(__dirname, '../data/benchmarks');

// 确保目录存在
if (!fs.existsSync(BENCHMARK_DIR)) {
  fs.mkdirSync(BENCHMARK_DIR, { recursive: true });
}

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30000, ...options }).trim();
  } catch (e) {
    return null;
  }
}

function timestamp() {
  return new Date().toISOString();
}

class BenchmarkRunner {
  constructor(serviceName) {
    this.serviceName = serviceName;
    this.service = config.services[serviceName];
    this.results = {
      service: serviceName,
      timestamp: timestamp(),
      tests: {}
    };
  }
  
  // 测试 1：启动时间（systemd 服务）
  testStartupTime() {
    if (!this.service.service) {
      return null;
    }
    
    console.log('  测试启动时间...');
    
    const startTime = Date.now();
    
    // 重启服务
    exec(`systemctl --user restart ${this.service.service}`);
    
    // 等待服务完全启动
    let attempts = 0;
    while (attempts < 30) {
      const status = exec(`systemctl --user is-active ${this.service.service}`);
      if (status === 'active') {
        break;
      }
      exec('sleep 0.5');
      attempts++;
    }
    
    const elapsed = Date.now() - startTime;
    
    return {
      metric: 'startup_time_ms',
      value: elapsed,
      unit: 'ms',
      passed: elapsed < 10000 // 10秒内启动算通过
    };
  }
  
  // 测试 2：健康检查响应时间
  testHealthCheckTime() {
    if (!this.service.healthCheck) {
      return null;
    }
    
    console.log('  测试健康检查响应时间...');
    
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
      passed: elapsed < 1000 // 1秒内响应算通过
    };
  }
  
  // 测试 3：内存占用
  testMemoryUsage() {
    if (!this.service.service) {
      return null;
    }
    
    console.log('  测试内存占用...');
    
    // 获取服务进程内存使用
    const pid = exec(`systemctl --user show ${this.service.service} -p MainPID --value`);
    if (!pid || pid === '0') {
      return null;
    }
    
    const memory = exec(`ps -p ${pid} -o rss=`) || '0';
    const memoryMB = Math.round(parseInt(memory) / 1024);
    
    return {
      metric: 'memory_usage_mb',
      value: memoryMB,
      unit: 'MB',
      passed: memoryMB < 500 // 小于500MB算通过
    };
  }
  
  // 测试 4：CPU 使用率（短期）
  testCpuUsage() {
    if (!this.service.service) {
      return null;
    }
    
    console.log('  测试 CPU 使用率...');
    
    const pid = exec(`systemctl --user show ${this.service.service} -p MainPID --value`);
    if (!pid || pid === '0') {
      return null;
    }
    
    // 等待2秒收集数据
    const cpu1 = exec(`ps -p ${pid} -o %cpu=`) || '0.0';
    exec('sleep 2');
    const cpu2 = exec(`ps -p ${pid} -o %cpu=`) || '0.0';
    
    const avgCpu = (parseFloat(cpu1) + parseFloat(cpu2)) / 2;
    
    return {
      metric: 'cpu_usage_percent',
      value: parseFloat(avgCpu.toFixed(2)),
      unit: '%',
      passed: avgCpu < 50 // CPU使用率小于50%算通过
    };
  }
  
  // 测试 5：文件数量（针对 agent 类型）
  testFileCount() {
    if (!this.service.path) {
      return null;
    }
    
    console.log('  测试文件数量...');
    
    const count = exec(`find "${this.service.path}" -type f | wc -l`) || '0';
    
    return {
      metric: 'file_count',
      value: parseInt(count),
      unit: 'files',
      passed: true // 仅记录，不判断
    };
  }
  
  // 测试 6：磁盘占用
  testDiskUsage() {
    if (!this.service.path) {
      return null;
    }
    
    console.log('  测试磁盘占用...');
    
    const size = exec(`du -sm "${this.service.path}" | cut -f1`) || '0';
    
    return {
      metric: 'disk_usage_mb',
      value: parseInt(size),
      unit: 'MB',
      passed: parseInt(size) < 1000 // 小于1GB算通过
    };
  }
  
  // 运行所有基准测试
  runAll() {
    console.log(`\n🔬 运行基准测试：${this.serviceName}`);
    
    const tests = [
      this.testStartupTime(),
      this.testHealthCheckTime(),
      this.testMemoryUsage(),
      this.testCpuUsage(),
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
    
    // 计算总分
    const passedTests = Object.values(this.results.tests).filter(t => t.passed).length;
    const totalTests = Object.values(this.results.tests).filter(t => t.passed !== undefined).length;
    
    this.results.score = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
    this.results.passed_tests = passedTests;
    this.results.total_tests = totalTests;
    
    console.log(`✅ 基准测试完成：${passedTests}/${totalTests} 通过 (${this.results.score}分)`);
    
    return this.results;
  }
  
  // 保存结果
  save() {
    const filename = path.join(BENCHMARK_DIR, `${this.serviceName}-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
    return filename;
  }
  
  // 与历史比较
  compare() {
    const files = fs.readdirSync(BENCHMARK_DIR)
      .filter(f => f.startsWith(`${this.serviceName}-`) && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length < 2) {
      return { has_baseline: false };
    }
    
    // 最新的是当前结果，取倒数第二个作为baseline
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
  
  // 判断是否性能退化
  isRegression(metric, changePercent) {
    const regressionThresholds = {
      'startup_time_ms': 20,      // 启动时间增加>20%
      'health_check_time_ms': 50, // 健康检查时间增加>50%
      'memory_usage_mb': 30,       // 内存增加>30%
      'cpu_usage_percent': 50,     // CPU增加>50%
      'disk_usage_mb': 50          // 磁盘增加>50%
    };
    
    const threshold = regressionThresholds[metric] || 100;
    return changePercent > threshold;
  }
}

// 格式化比较报告
function formatComparison(serviceName, comparison) {
  if (!comparison.has_baseline) {
    return '📊 基准测试完成（首次运行，无历史数据比较）';
  }
  
  const lines = [`\n📊 性能比较报告：${serviceName}\n`];
  
  let hasRegression = false;
  
  Object.entries(comparison.changes).forEach(([metric, data]) => {
    const icon = data.regression ? '🔴' : data.change_percent < -10 ? '🟢' : '⚪';
    const direction = data.change > 0 ? '↑' : '↓';
    
    const metricNames = {
      'startup_time_ms': '启动时间',
      'health_check_time_ms': '健康检查',
      'memory_usage_mb': '内存占用',
      'cpu_usage_percent': 'CPU使用',
      'disk_usage_mb': '磁盘占用',
      'file_count': '文件数量'
    };
    
    const name = metricNames[metric] || metric;
    
    lines.push(`${icon} ${name}: ${data.current} ${direction} ${Math.abs(data.change_percent)}%`);
    
    if (data.regression) {
      hasRegression = true;
    }
  });
  
  if (hasRegression) {
    lines.push('\n⚠️ 检测到性能退化！');
  }
  
  return lines.join('\n');
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const serviceName = args[0];
  
  if (!serviceName) {
    console.log(`
性能基准测试工具

用法：
  node benchmark.js <service>

示例：
  node benchmark.js openclaw-gateway
  node benchmark.js knowledge-digest
    `);
    process.exit(1);
  }
  
  if (!config.services[serviceName]) {
    console.error(`❌ 服务不存在：${serviceName}`);
    process.exit(1);
  }
  
  const benchmark = new BenchmarkRunner(serviceName);
  const results = benchmark.runAll();
  
  const filename = benchmark.save();
  console.log(`\n💾 结果已保存：${filename}`);
  
  const comparison = benchmark.compare();
  console.log(formatComparison(serviceName, comparison));
  
  // 输出 JSON 供其他脚本使用
  console.log('\n--- JSON ---');
  console.log(JSON.stringify({ results, comparison }, null, 2));
}

module.exports = { BenchmarkRunner, formatComparison };
