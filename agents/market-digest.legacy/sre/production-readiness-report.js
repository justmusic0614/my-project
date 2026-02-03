#!/usr/bin/env node
// SRE Production Readiness Report
// 驗證系統是否達到 100% 生產級別穩定性

const { createHealthCheckSystem } = require('./health-check');
const { getManager: getCircuitBreakerManager } = require('./circuit-breaker');
const DependencyChecker = require('./dependency-checker');
const fs = require('fs');
const path = require('path');

/**
 * 生產就緒檢查清單
 */
const PRODUCTION_CHECKLIST = [
  {
    category: '基礎設施',
    checks: [
      { id: 'deps', name: '依賴檢查通過', weight: 10 },
      { id: 'config', name: '設定檔有效', weight: 5 },
      { id: 'dirs', name: '必要目錄存在', weight: 5 }
    ]
  },
  {
    category: '錯誤處理',
    checks: [
      { id: 'global-handler', name: '全局錯誤處理器', weight: 15 },
      { id: 'json-safety', name: 'JSON 解析保護', weight: 10 },
      { id: 'exec-timeout', name: 'execSync timeout', weight: 10 }
    ]
  },
  {
    category: 'SRE 系統',
    checks: [
      { id: 'circuit-breaker', name: 'Circuit Breaker', weight: 15 },
      { id: 'degradation', name: '優雅降級機制', weight: 10 },
      { id: 'health-check', name: '健康檢查系統', weight: 10 }
    ]
  },
  {
    category: '運維',
    checks: [
      { id: 'cron-wrapper', name: 'Cron Wrapper', weight: 5 },
      { id: 'logging', name: '結構化日誌', weight: 5 },
      { id: 'monitoring', name: '監控機制', weight: 5 }
    ]
  }
];

class ProductionReadinessChecker {
  constructor() {
    this.results = [];
    this.score = 0;
    this.maxScore = 0;
    
    // 計算總分
    for (const category of PRODUCTION_CHECKLIST) {
      for (const check of category.checks) {
        this.maxScore += check.weight;
      }
    }
  }

  /**
   * 執行完整檢查
   */
  async runAll() {
    console.log('🎯 SRE Production Readiness Report');
    console.log('═'.repeat(70));
    console.log('');
    
    for (const category of PRODUCTION_CHECKLIST) {
      console.log(`📋 ${category.category}`);
      console.log('─'.repeat(70));
      
      for (const check of category.checks) {
        const result = await this.runCheck(check);
        this.results.push(result);
        
        const emoji = result.passed ? '✅' : '❌';
        const score = result.passed ? check.weight : 0;
        this.score += score;
        
        console.log(`${emoji} ${check.name} (${score}/${check.weight})`);
        
        if (result.details) {
          console.log(`   ${result.details}`);
        }
        
        if (!result.passed && result.reason) {
          console.log(`   原因: ${result.reason}`);
        }
      }
      
      console.log('');
    }
    
    this.displaySummary();
  }

  /**
   * 執行單個檢查
   */
  async runCheck(check) {
    try {
      switch (check.id) {
        case 'deps':
          return await this.checkDependencies();
        case 'config':
          return this.checkConfig();
        case 'dirs':
          return this.checkDirectories();
        case 'global-handler':
          return this.checkGlobalErrorHandler();
        case 'json-safety':
          return this.checkJSONSafety();
        case 'exec-timeout':
          return this.checkExecTimeout();
        case 'circuit-breaker':
          return this.checkCircuitBreaker();
        case 'degradation':
          return this.checkDegradation();
        case 'health-check':
          return await this.checkHealthCheck();
        case 'cron-wrapper':
          return this.checkCronWrapper();
        case 'logging':
          return this.checkLogging();
        case 'monitoring':
          return this.checkMonitoring();
        default:
          return { passed: false, reason: '未實作' };
      }
    } catch (err) {
      return { passed: false, reason: err.message };
    }
  }

  async checkDependencies() {
    const checker = new DependencyChecker();
    const result = await checker.check();
    return {
      passed: result.status === 'PASS',
      details: `${result.passed} passed, ${result.failed} failed`
    };
  }

  checkConfig() {
    try {
      const configPath = path.join(__dirname, '../config.json');
      const content = fs.readFileSync(configPath, 'utf8');
      JSON.parse(content);
      return { passed: true };
    } catch (err) {
      return { passed: false, reason: err.message };
    }
  }

  checkDirectories() {
    const dirs = ['data/cache', 'data/runtime', 'data/morning-collect', 'logs'];
    const missing = [];
    
    for (const dir of dirs) {
      const fullPath = path.join(__dirname, '..', dir);
      if (!fs.existsSync(fullPath)) {
        missing.push(dir);
      }
    }
    
    if (missing.length > 0) {
      return { passed: false, reason: `缺少目錄: ${missing.join(', ')}` };
    }
    
    return { passed: true };
  }

  checkGlobalErrorHandler() {
    const handlerPath = path.join(__dirname, '../global-error-handler.js');
    return { passed: fs.existsSync(handlerPath) };
  }

  checkJSONSafety() {
    // 檢查 morning-collector.js 是否有 safeReadJSON
    const collectorPath = path.join(__dirname, '../morning-collector.js');
    const content = fs.readFileSync(collectorPath, 'utf8');
    const hasSafeRead = content.includes('safeReadJSON');
    
    return { 
      passed: hasSafeRead,
      details: hasSafeRead ? 'safeReadJSON 已實作' : '缺少 safeReadJSON'
    };
  }

  checkExecTimeout() {
    // 檢查 smart-integrator.js 是否有 timeout
    const integratorPath = path.join(__dirname, '../smart-integrator.js');
    const content = fs.readFileSync(integratorPath, 'utf8');
    const hasTimeout = content.includes('timeout:');
    
    return {
      passed: hasTimeout,
      details: hasTimeout ? 'execSync timeout 已設定' : '缺少 timeout'
    };
  }

  checkCircuitBreaker() {
    const cbPath = path.join(__dirname, 'circuit-breaker.js');
    const adapterPath = path.join(__dirname, '../backend/sources/adapter.js');
    
    if (!fs.existsSync(cbPath)) {
      return { passed: false, reason: 'circuit-breaker.js 不存在' };
    }
    
    const adapterContent = fs.readFileSync(adapterPath, 'utf8');
    const integrated = adapterContent.includes('circuit-breaker');
    
    return {
      passed: integrated,
      details: integrated ? '已整合到 adapter' : '未整合到 adapter'
    };
  }

  checkDegradation() {
    const degPath = path.join(__dirname, 'graceful-degradation.js');
    return { passed: fs.existsSync(degPath) };
  }

  async checkHealthCheck() {
    try {
      const healthCheck = createHealthCheckSystem();
      const status = await healthCheck.runAll();
      return {
        passed: status.status !== 'CRITICAL',
        details: `狀態: ${status.status}, ${status.checks.healthy}/${status.checks.total} passed`
      };
    } catch (err) {
      return { passed: false, reason: err.message };
    }
  }

  checkCronWrapper() {
    const wrapperPath = path.join(__dirname, 'cron-wrapper.sh');
    return { passed: fs.existsSync(wrapperPath) };
  }

  checkLogging() {
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
      return { passed: false, reason: 'logs 目錄不存在' };
    }
    
    const files = fs.readdirSync(logsDir);
    return {
      passed: files.length > 0,
      details: `${files.length} 個日誌檔案`
    };
  }

  checkMonitoring() {
    // 檢查是否有監控機制（Circuit Breaker + Health Check）
    const cbPath = path.join(__dirname, 'circuit-breaker.js');
    const hcPath = path.join(__dirname, 'health-check.js');
    
    const hasBoth = fs.existsSync(cbPath) && fs.existsSync(hcPath);
    return { passed: hasBoth };
  }

  /**
   * 顯示摘要
   */
  displaySummary() {
    console.log('═'.repeat(70));
    console.log('📊 Production Readiness Summary');
    console.log('═'.repeat(70));
    console.log('');
    
    const percentage = ((this.score / this.maxScore) * 100).toFixed(1);
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    console.log(`得分: ${this.score}/${this.maxScore} (${percentage}%)`);
    console.log(`通過: ${passed}/${this.results.length}`);
    console.log(`失敗: ${failed}/${this.results.length}`);
    console.log('');
    
    // 評級
    let grade, emoji, status;
    if (percentage >= 95) {
      grade = 'A+';
      emoji = '🟢';
      status = '生產就緒';
    } else if (percentage >= 90) {
      grade = 'A';
      emoji = '🟢';
      status = '接近生產就緒';
    } else if (percentage >= 80) {
      grade = 'B';
      emoji = '🟡';
      status = '需要改善';
    } else {
      grade = 'C';
      emoji = '🔴';
      status = '不建議生產部署';
    }
    
    console.log(`評級: ${emoji} ${grade} - ${status}`);
    console.log('');
    
    if (failed > 0) {
      console.log('⚠️  失敗項目:');
      for (const result of this.results.filter(r => !r.passed)) {
        const check = this.findCheck(result);
        console.log(`   ❌ ${check.name}: ${result.reason}`);
      }
      console.log('');
    }
    
    console.log('═'.repeat(70));
    
    // 建議
    if (percentage < 100) {
      console.log('\n💡 建議:');
      if (failed > 0) {
        console.log('   1. 修復所有失敗項目');
      }
      console.log('   2. 執行完整測試套件');
      console.log('   3. 部署到 staging 環境驗證');
    } else {
      console.log('\n🎉 系統已達到 100% 生產就緒！');
    }
  }

  findCheck(result) {
    for (const category of PRODUCTION_CHECKLIST) {
      for (const check of category.checks) {
        if (this.results[this.results.indexOf(result)] === result) {
          return check;
        }
      }
    }
    return { name: 'Unknown' };
  }
}

// 執行檢查
if (require.main === module) {
  const checker = new ProductionReadinessChecker();
  checker.runAll().catch(err => {
    console.error('❌ 檢查失敗:', err);
    process.exit(1);
  });
}

module.exports = ProductionReadinessChecker;
