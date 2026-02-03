#!/usr/bin/env node
// 測試所有新系統

const TimeSeriesStorage = require('./backend/timeseries-storage');
const { ExperimentTracker } = require('./experiments/experiment-tracker');
const PluginManager = require('./backend/sources/plugin-manager');

async function testAll() {
  console.log('🧪 測試系統升級\n');
  console.log('='.repeat(60));
  
  // 1. 測試時間序列儲存
  console.log('\n【1/3】時間序列儲存系統');
  console.log('─'.repeat(60));
  
  try {
    const ts = new TimeSeriesStorage();
    const stats = await ts.getStats();
    
    console.log('✅ 時間序列儲存系統運作正常');
    console.log(`   - 市場數據: ${stats.marketData} 筆`);
    console.log(`   - 新聞資料: ${stats.news} 筆`);
    console.log(`   - 報告: ${stats.reports} 筆`);
    
    // 測試查詢
    const today = new Date().toISOString().split('T')[0];
    const twiiData = await ts.loadMarketData(today, 'TWII');
    
    if (twiiData) {
      console.log(`   - 今日台股數據: ${twiiData.data.close?.toFixed(2) || 'N/A'}`);
    }
  } catch (err) {
    console.error('❌ 時間序列儲存測試失敗:', err.message);
  }
  
  // 2. 測試實驗追蹤
  console.log('\n【2/3】實驗追蹤系統');
  console.log('─'.repeat(60));
  
  try {
    const tracker = new ExperimentTracker();
    const experiments = await tracker.listExperiments(5);
    const stats = await tracker.getStats();
    
    console.log('✅ 實驗追蹤系統運作正常');
    console.log(`   - 總實驗數: ${stats.total}`);
    console.log(`   - 實驗類型: ${Object.keys(stats.byName).length} 種`);
    
    if (experiments.length > 0) {
      console.log(`   - 最近實驗: ${experiments[0].name} (${experiments[0].timestamp})`);
    }
  } catch (err) {
    console.error('❌ 實驗追蹤測試失敗:', err.message);
  }
  
  // 3. 測試 Plugin 系統
  console.log('\n【3/3】Plugin 系統');
  console.log('─'.repeat(60));
  
  try {
    const pm = new PluginManager();
    const plugins = pm.listPlugins();
    const stats = pm.getStats();
    
    console.log('✅ Plugin 系統運作正常');
    console.log(`   - 總 Plugin 數: ${stats.total}`);
    console.log(`   - 已啟用: ${stats.enabled}`);
    console.log(`   - 按類型分佈:`, stats.byType);
    
    console.log('\n   Plugin 清單:');
    for (const plugin of plugins) {
      const status = plugin.enabled ? '🟢' : '🔴';
      console.log(`   ${status} ${plugin.name} (${plugin.type}) v${plugin.version}`);
    }
  } catch (err) {
    console.error('❌ Plugin 系統測試失敗:', err.message);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ 所有系統測試完成\n');
}

testAll().catch(err => {
  console.error('❌ 測試失敗:', err);
  process.exit(1);
});
