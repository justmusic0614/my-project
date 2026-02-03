#!/usr/bin/env node
// 測試全局錯誤處理器 - 模擬各種 crash 場景

const errorHandler = require('./global-error-handler');
errorHandler.install({
  appName: 'error-handler-test',
  logDir: require('path').join(__dirname, 'logs'),
  maxErrorRate: 5
});

console.log('🧪 開始錯誤處理器測試\n');

// 測試場景
const tests = [
  {
    name: '1. Recoverable Error (API timeout)',
    run: () => {
      const err = new Error('connect ETIMEDOUT 203.0.113.1:443');
      process.emit('unhandledRejection', err, Promise.reject(err));
    },
    expected: 'RECOVERED'
  },
  {
    name: '2. Recoverable Error (Connection refused)',
    run: () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:8080');
      process.emit('unhandledRejection', err, Promise.reject(err));
    },
    expected: 'RECOVERED'
  },
  {
    name: '3. Recoverable Error (Rate limit)',
    run: () => {
      const err = new Error('HTTP 429 Too Many Requests');
      process.emit('unhandledRejection', err, Promise.reject(err));
    },
    expected: 'RECOVERED'
  },
  {
    name: '4. 健康狀態報告',
    run: () => {
      const health = errorHandler.getHandler().getHealthReport();
      console.log('   健康狀態:');
      console.log(`     - 總錯誤數: ${health.errorCounts.unhandledRejection}`);
      console.log(`     - Recoverable: ${health.errorCounts.recoverable}`);
      console.log(`     - Fatal: ${health.errorCounts.fatal}`);
      console.log(`     - 最近錯誤率: ${health.recentErrorRate}/分鐘`);
    },
    expected: 'REPORT'
  }
];

// 執行測試
let testIndex = 0;

function runNextTest() {
  if (testIndex >= tests.length) {
    console.log('\n✅ 所有測試完成！');
    console.log('\n📋 最終報告:');
    const finalHealth = errorHandler.getHandler().getHealthReport();
    console.log(JSON.stringify(finalHealth, null, 2));
    
    console.log('\n📄 日誌檔案已寫入:');
    console.log(`   logs/error-${new Date().toISOString().split('T')[0]}.log`);
    
    process.exit(0);
    return;
  }

  const test = tests[testIndex];
  console.log(`\n${test.name}`);
  
  try {
    test.run();
    setTimeout(() => {
      console.log(`   ✅ ${test.expected}`);
      testIndex++;
      runNextTest();
    }, 100);
  } catch (err) {
    console.log(`   ❌ FAILED: ${err.message}`);
    testIndex++;
    runNextTest();
  }
}

// 延遲啟動，確保錯誤處理器已初始化
setTimeout(runNextTest, 200);
