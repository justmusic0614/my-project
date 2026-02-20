// SRE Dependency Checker
// 啟動前檢查所有外部依賴的可用性

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class DependencyChecker {
  constructor() {
    this.dependencies = {
      // 檔案系統依賴
      files: [
        { path: './config.json', required: true, type: 'file' },
        { path: './data/cache', required: true, type: 'dir' },
        { path: './data/runtime', required: true, type: 'dir' },
        { path: './data/morning-collect', required: true, type: 'dir' },
        { path: './logs', required: true, type: 'dir' }
      ],
      
      // Node 模組依賴
      modules: [
        { name: 'node-fetch', required: true },
        { name: 'path', required: true },
        { name: 'fs', required: true }
      ],
      
      // 外部指令依賴
      commands: [
        { cmd: 'node', args: ['--version'], required: true },
        { cmd: 'clawdbot', args: ['--version'], required: false, note: '僅推播需要' }
      ],
      
      // API 端點依賴（可選）
      apis: [
        {
          name: 'Yahoo Finance',
          url: 'https://query1.finance.yahoo.com/v8/finance/chart/^TWII?interval=1d&range=1d',
          required: false,
          timeout: 5000
        }
      ]
    };
    
    this.results = {
      passed: [],
      failed: [],
      warnings: []
    };
  }

  /**
   * 執行完整依賴檢查
   */
  async check() {
    console.log('🔍 SRE Dependency Check\n');
    
    // 1. 檔案系統檢查
    this.checkFiles();

    // 2. Node 模組檢查
    this.checkModules();

    // 3. 外部指令檢查（異步，不阻塞事件循環）
    await this.checkCommands();

    // 4. API 端點檢查（非同步）
    await this.checkAPIs();
    
    // 5. 生成報告
    return this.generateReport();
  }

  /**
   * 檢查檔案與目錄
   */
  checkFiles() {
    console.log('📁 檢查檔案系統...');
    
    for (const item of this.dependencies.files) {
      const fullPath = path.join(__dirname, '..', item.path);
      
      try {
        const exists = fs.existsSync(fullPath);
        
        if (!exists) {
          if (item.required) {
            this.results.failed.push({
              type: 'file',
              item: item.path,
              reason: '檔案或目錄不存在',
              severity: 'CRITICAL'
            });
          } else {
            this.results.warnings.push({
              type: 'file',
              item: item.path,
              reason: '檔案或目錄不存在（非必要）'
            });
          }
        } else {
          // 檢查類型
          const stat = fs.statSync(fullPath);
          const isCorrectType = 
            (item.type === 'file' && stat.isFile()) ||
            (item.type === 'dir' && stat.isDirectory());
          
          if (!isCorrectType) {
            this.results.failed.push({
              type: 'file',
              item: item.path,
              reason: `預期 ${item.type}，實際 ${stat.isFile() ? 'file' : 'dir'}`,
              severity: 'HIGH'
            });
          } else {
            this.results.passed.push({
              type: 'file',
              item: item.path
            });
          }
        }
      } catch (err) {
        this.results.failed.push({
          type: 'file',
          item: item.path,
          reason: err.message,
          severity: item.required ? 'CRITICAL' : 'LOW'
        });
      }
    }
  }

  /**
   * 檢查 Node 模組
   */
  checkModules() {
    console.log('📦 檢查 Node 模組...');
    
    for (const mod of this.dependencies.modules) {
      try {
        require.resolve(mod.name);
        this.results.passed.push({
          type: 'module',
          item: mod.name
        });
      } catch (err) {
        if (mod.required) {
          this.results.failed.push({
            type: 'module',
            item: mod.name,
            reason: '模組不存在',
            severity: 'CRITICAL'
          });
        } else {
          this.results.warnings.push({
            type: 'module',
            item: mod.name,
            reason: '模組不存在（非必要）'
          });
        }
      }
    }
  }

  /**
   * 檢查外部指令（異步，不阻塞事件循環）
   */
  async checkCommands() {
    console.log('⚙️  檢查外部指令...');

    for (const cmd of this.dependencies.commands) {
      try {
        const { stdout } = await execAsync(`${cmd.cmd} ${cmd.args.join(' ')}`, {
          timeout: 3000,
          maxBuffer: 64 * 1024
        });

        this.results.passed.push({
          type: 'command',
          item: cmd.cmd,
          version: stdout.trim().split('\n')[0]
        });
      } catch (err) {
        if (cmd.required) {
          this.results.failed.push({
            type: 'command',
            item: cmd.cmd,
            reason: err.message,
            severity: 'CRITICAL'
          });
        } else {
          this.results.warnings.push({
            type: 'command',
            item: cmd.cmd,
            reason: `無法執行（${cmd.note || '非必要'}）`
          });
        }
      }
    }
  }

  /**
   * 檢查 API 端點
   */
  async checkAPIs() {
    console.log('🌐 檢查 API 端點...');
    
    const fetch = require('node-fetch');
    
    for (const api of this.dependencies.apis) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), api.timeout);
        
        const response = await fetch(api.url, {
          signal: controller.signal,
          method: 'GET'
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          this.results.passed.push({
            type: 'api',
            item: api.name,
            url: api.url,
            status: response.status
          });
        } else {
          if (api.required) {
            this.results.failed.push({
              type: 'api',
              item: api.name,
              reason: `HTTP ${response.status}`,
              severity: 'HIGH'
            });
          } else {
            this.results.warnings.push({
              type: 'api',
              item: api.name,
              reason: `HTTP ${response.status}（非必要）`
            });
          }
        }
      } catch (err) {
        if (api.required) {
          this.results.failed.push({
            type: 'api',
            item: api.name,
            reason: err.message,
            severity: 'HIGH'
          });
        } else {
          this.results.warnings.push({
            type: 'api',
            item: api.name,
            reason: `${err.message}（非必要）`
          });
        }
      }
    }
  }

  /**
   * 生成檢查報告
   */
  generateReport() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Dependency Check Report');
    console.log('='.repeat(60));
    
    console.log(`\n✅ Passed: ${this.results.passed.length}`);
    this.results.passed.forEach(item => {
      const detail = item.version ? ` (${item.version})` : '';
      console.log(`   ✓ ${item.type}: ${item.item}${detail}`);
    });
    
    if (this.results.warnings.length > 0) {
      console.log(`\n⚠️  Warnings: ${this.results.warnings.length}`);
      this.results.warnings.forEach(item => {
        console.log(`   ⚠ ${item.type}: ${item.item}`);
        console.log(`     ${item.reason}`);
      });
    }
    
    if (this.results.failed.length > 0) {
      console.log(`\n❌ Failed: ${this.results.failed.length}`);
      this.results.failed.forEach(item => {
        console.log(`   ✗ [${item.severity}] ${item.type}: ${item.item}`);
        console.log(`     ${item.reason}`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
    
    const hasCritical = this.results.failed.some(f => f.severity === 'CRITICAL');
    const status = hasCritical ? 'FAIL' : 'PASS';
    
    console.log(`Status: ${status}`);
    console.log('='.repeat(60) + '\n');
    
    return {
      status,
      passed: this.results.passed.length,
      failed: this.results.failed.length,
      warnings: this.results.warnings.length,
      hasCritical,
      details: this.results
    };
  }

  /**
   * 自動修復（創建缺失的目錄）
   */
  autoFix() {
    console.log('🔧 自動修復...');
    
    let fixed = 0;
    
    for (const item of this.dependencies.files) {
      if (item.type === 'dir') {
        const fullPath = path.join(__dirname, '..', item.path);
        if (!fs.existsSync(fullPath)) {
          try {
            fs.mkdirSync(fullPath, { recursive: true });
            console.log(`   ✓ 建立目錄: ${item.path}`);
            fixed++;
          } catch (err) {
            console.log(`   ✗ 無法建立目錄: ${item.path} (${err.message})`);
          }
        }
      }
    }
    
    if (fixed > 0) {
      console.log(`✅ 自動修復完成：${fixed} 項`);
    } else {
      console.log('ℹ️  無需修復');
    }
  }
}

// CLI 模式
if (require.main === module) {
  const checker = new DependencyChecker();
  
  const args = process.argv.slice(2);
  const autoFix = args.includes('--fix');
  
  if (autoFix) {
    checker.autoFix();
  }
  
  checker.check().then(report => {
    if (report.status === 'FAIL') {
      process.exit(1);
    }
    process.exit(0);
  });
}

module.exports = DependencyChecker;
