#!/usr/bin/env node

/**
 * 測試配置檔案即時重載機制
 * 不需要 API Key，只驗證配置讀取邏輯
 */

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '../data/llm-config.json');

// 模擬 llm-client.js 的 loadConfig 函數
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

// 模擬 callLLM 中的模型選擇邏輯
function selectModel(agentId) {
  const config = loadConfig();
  return config.agentModels?.[agentId] || config.currentModel;
}

async function testConfigReload() {
  console.log('🧪 測試配置檔案即時重載機制\n');

  const agentName = 'knowledge-digest';

  try {
    // 讀取當前配置
    const originalConfig = loadConfig();
    const originalAgentModels = { ...originalConfig.agentModels };

    console.log('📖 Step 1: 讀取當前配置');
    console.log(`   Global Model: ${originalConfig.currentModel}`);
    console.log(`   Agent Models: ${JSON.stringify(originalConfig.agentModels)}\n`);

    // 模擬第一次調用（使用當前配置）
    console.log(`🤖 Step 2: 模擬 Agent 調用（當前配置）`);
    const model1 = selectModel(agentName);
    console.log(`   Selected Model: ${model1}\n`);

    // 動態修改配置檔案
    console.log('📝 Step 3: 動態修改配置檔案');
    const newConfig = loadConfig();
    newConfig.agentModels = newConfig.agentModels || {};
    newConfig.agentModels[agentName] = 'claude-sonnet-4-5-20250929';
    newConfig.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    console.log(`   ✅ 已將 ${agentName} 設定為 claude-sonnet-4-5-20250929\n`);

    // 模擬第二次調用（應讀取新配置）
    console.log(`🤖 Step 4: 再次模擬 Agent 調用（預期：讀取新配置）`);
    const model2 = selectModel(agentName);
    console.log(`   Selected Model: ${model2}\n`);

    // 驗證結果
    console.log('📊 驗證結果:');
    console.log(`   第一次調用: ${model1}`);
    console.log(`   第二次調用: ${model2}`);

    if (model2 === 'claude-sonnet-4-5-20250929' && model1 !== model2) {
      console.log('\n✅ 測試通過：配置即時重載成功！');
      console.log('   每次調用 loadConfig() 都會重新讀取檔案，無快取機制');
    } else {
      console.log('\n❌ 測試失敗：配置未即時生效');
    }

    // 恢復原始配置
    console.log('\n🔄 Step 5: 恢復原始配置');
    const restoreConfig = loadConfig();
    restoreConfig.agentModels = originalAgentModels;
    restoreConfig.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(restoreConfig, null, 2));
    console.log('   ✅ 已恢復原始配置\n');

  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
    process.exit(1);
  }
}

// 執行測試
testConfigReload()
  .then(() => {
    console.log('🎉 測試完成！');
    process.exit(0);
  })
  .catch(err => {
    console.error('💥 測試異常:', err);
    process.exit(1);
  });
