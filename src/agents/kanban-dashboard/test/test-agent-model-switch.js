#!/usr/bin/env node

/**
 * 測試 Agent 模型即時切換功能
 *
 * 測試步驟：
 * 1. 設定 knowledge-digest 使用 Claude Haiku
 * 2. 執行 LLM 調用，確認使用 Haiku
 * 3. 動態切換到 Claude Sonnet
 * 4. 再次執行 LLM 調用，確認使用 Sonnet
 */

const llmClient = require('../server/services/llm-client');
const llmConfigService = require('../server/services/llm-config-service');

async function testAgentModelSwitch() {
  console.log('🧪 測試 Agent 模型即時切換功能\n');

  const agentName = 'knowledge-digest';
  const testPrompt = 'Please respond with only: "Hello from [MODEL_NAME]"';

  try {
    // Step 1: 設定為 Haiku
    console.log('📝 Step 1: 設定 knowledge-digest 使用 Claude Haiku 4.5');
    await llmConfigService.updateAgentModel(agentName, 'claude-haiku-4-5-20251001');
    console.log('✅ 配置已更新\n');

    // Step 2: 執行調用（應使用 Haiku）
    console.log('🤖 Step 2: 執行 LLM 調用（預期：Claude Haiku）');
    const result1 = await llmClient.callLLM(testPrompt, {
      agentId: agentName,
      maxTokens: 50,
      source: 'test'
    });
    console.log(`📊 回應: ${result1.text.substring(0, 100)}`);
    console.log(`💰 成本: $${result1.cost.total.toFixed(6)}`);
    console.log(`🏷️  模型: 應為 Claude Haiku (成本較低)\n`);

    // Step 3: 切換到 Sonnet
    console.log('📝 Step 3: 動態切換到 Claude Sonnet 4.5（不重啟服務）');
    await llmConfigService.updateAgentModel(agentName, 'claude-sonnet-4-5-20250929');
    console.log('✅ 配置已更新\n');

    // Step 4: 再次執行調用（應使用 Sonnet）
    console.log('🤖 Step 4: 再次執行 LLM 調用（預期：Claude Sonnet）');
    const result2 = await llmClient.callLLM(testPrompt, {
      agentId: agentName,
      maxTokens: 50,
      source: 'test'
    });
    console.log(`📊 回應: ${result2.text.substring(0, 100)}`);
    console.log(`💰 成本: $${result2.cost.total.toFixed(6)}`);
    console.log(`🏷️  模型: 應為 Claude Sonnet (成本較高)\n`);

    // 比較成本
    console.log('📈 成本比較:');
    console.log(`   Haiku:  $${result1.cost.total.toFixed(6)}`);
    console.log(`   Sonnet: $${result2.cost.total.toFixed(6)}`);
    console.log(`   差異:   $${(result2.cost.total - result1.cost.total).toFixed(6)}\n`);

    if (result2.cost.total > result1.cost.total) {
      console.log('✅ 測試通過：模型即時切換成功！Sonnet 成本高於 Haiku');
    } else {
      console.log('❌ 測試失敗：成本未符合預期');
    }

    // Step 5: 恢復為預設
    console.log('\n🔄 Step 5: 重置配置（回歸全局預設）');
    await llmConfigService.updateAgentModel(agentName, null);
    console.log('✅ 已重置為全局預設模型\n');

  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
    process.exit(1);
  }
}

// 執行測試
testAgentModelSwitch()
  .then(() => {
    console.log('🎉 測試完成！');
    process.exit(0);
  })
  .catch(err => {
    console.error('💥 測試異常:', err);
    process.exit(1);
  });
