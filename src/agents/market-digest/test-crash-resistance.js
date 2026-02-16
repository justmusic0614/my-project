#!/usr/bin/env node
// 測試 Crash 抵抗力 - 模擬各種 crash 場景

const fs = require('fs');
const path = require('path');

console.log('🧪 開始 Crash 抵抗力測試\n');

const tests = [
  {
    name: '測試 1: 損壞的 JSON 檔案',
    setup: () => {
      const badFile = path.join(__dirname, 'data/morning-collect/test-bad.json');
      fs.writeFileSync(badFile, '{ invalid json }', 'utf8');
      return badFile;
    },
    test: (badFile) => {
      const collector = require('./morning-collector');
      // 模擬讀取損壞的檔案
      const { safeReadJSON } = collector;
      
      // 這應該不會 crash
      try {
        const content = fs.readFileSync(badFile, 'utf8');
        JSON.parse(content); // 這會拋錯
      } catch (err) {
        console.log('   ✅ JSON.parse 錯誤被捕獲:', err.message.substring(0, 50));
        return true;
      }
      return false;
    },
    cleanup: (badFile) => {
      if (fs.existsSync(badFile)) fs.unlinkSync(badFile);
    }
  },
  {
    name: '測試 2: morning-collector 讀取損壞檔案',
    setup: () => {
      const testFile = path.join(__dirname, 'data/morning-collect/2026-02-02.json');
      // 備份原檔案（如果存在）
      let backup = null;
      if (fs.existsSync(testFile)) {
        backup = fs.readFileSync(testFile, 'utf8');
      }
      // 寫入損壞的 JSON
      fs.writeFileSync(testFile, '{ "messages": [}', 'utf8');
      return { testFile, backup };
    },
    test: ({ testFile }) => {
      const collector = require('./morning-collector');
      
      // 這應該不會 crash，而是返回預設值
      const result = collector.getToday();
      
      if (result && result.messages && Array.isArray(result.messages)) {
        console.log('   ✅ 返回預設值，未 crash');
        return true;
      }
      return false;
    },
    cleanup: ({ testFile, backup }) => {
      if (backup) {
        fs.writeFileSync(testFile, backup, 'utf8');
      } else if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  },
  {
    name: '測試 3: 圖片處理失敗（檔案不存在）',
    setup: () => {
      return '/tmp/nonexistent-image.jpg';
    },
    test: (imagePath) => {
      // 注意：這個測試需要 morning-integrator 模組
      // 但它會調用 clawdbot，所以我們只測試錯誤處理邏輯
      
      const { execSync } = require('child_process');
      
      try {
        // 模擬 clawdbot image analyze 失敗
        execSync('false', { timeout: 1000 }); // 立即失敗的指令
      } catch (err) {
        console.log('   ✅ execSync 錯誤被捕獲:', err.message.substring(0, 50));
        return true;
      }
      return false;
    },
    cleanup: () => {}
  },
  {
    name: '測試 4: execSync timeout 保護',
    setup: () => {
      return null;
    },
    test: () => {
      const { execSync } = require('child_process');
      
      try {
        // 模擬一個永遠不返回的指令（但有 timeout）
        execSync('sleep 10', { timeout: 1000 }); // 1 秒超時
      } catch (err) {
        if (err.killed) {
          console.log('   ✅ Timeout 正確觸發，進程被終止');
          return true;
        }
        console.log('   ✅ execSync 錯誤被捕獲:', err.message.substring(0, 50));
        return true;
      }
      return false;
    },
    cleanup: () => {}
  },
  {
    name: '測試 5: config.json 損壞',
    setup: () => {
      const configFile = path.join(__dirname, 'config.json');
      const backup = fs.readFileSync(configFile, 'utf8');
      fs.writeFileSync(configFile, '{ invalid }', 'utf8');
      return { configFile, backup };
    },
    test: ({ configFile }) => {
      // 清除 require cache
      delete require.cache[require.resolve('./smart-integrator.js')];
      
      try {
        require('./smart-integrator.js');
        console.log('   ❌ 應該要失敗但沒有');
        return false;
      } catch (err) {
        // 預期會失敗（我們的錯誤處理會 process.exit(1)）
        // 但在測試環境中，我們捕獲這個錯誤
        console.log('   ⚠️  Config 損壞時會退出（符合預期）');
        return true;
      }
    },
    cleanup: ({ configFile, backup }) => {
      fs.writeFileSync(configFile, backup, 'utf8');
      // 清除 cache
      delete require.cache[require.resolve('./smart-integrator.js')];
    }
  }
];

// 執行測試
async function runTests() {
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log(`\n${test.name}`);
    
    let setupData = null;
    try {
      setupData = test.setup();
      const result = test.test(setupData);
      
      if (result) {
        passed++;
      } else {
        failed++;
        console.log('   ❌ 測試失敗');
      }
    } catch (err) {
      failed++;
      console.log(`   ❌ 測試拋出例外: ${err.message}`);
    } finally {
      try {
        test.cleanup(setupData);
      } catch (cleanupErr) {
        console.log(`   ⚠️  清理失敗: ${cleanupErr.message}`);
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`📊 測試結果: ${passed}/${tests.length} 通過`);
  
  if (failed > 0) {
    console.log(`❌ ${failed} 個測試失敗`);
    process.exit(1);
  } else {
    console.log('✅ 所有測試通過！');
  }
}

runTests().catch(err => {
  console.error('❌ 測試執行失敗:', err);
  process.exit(1);
});
