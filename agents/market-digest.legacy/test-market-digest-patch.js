#!/usr/bin/env node
// 測試 RESEARCH_SIGNAL_UPGRADE_PATCH 套用到 Market Digest

const fs = require('fs');
const path = require('path');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const { renderReport } = require('./institutional-renderer');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

async function testMarketDigestPatch() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Market Digest + RESEARCH_SIGNAL_UPGRADE_PATCH 測試');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    // 1. 生成 Runtime Input（套用 PATCH）
    const generator = new RuntimeInputGenerator(config);
    const runtimeInput = await generator.generate();
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 PATCH 驗收');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // 驗收 PATCH 結果
    console.log('✅ Primary Signals (Top 3):');
    if (runtimeInput.primary_signals && runtimeInput.primary_signals.length > 0) {
      runtimeInput.primary_signals.forEach((signal, idx) => {
        console.log(`   ${idx + 1}. ${signal}`);
      });
    } else {
      console.log('   N/A');
    }
    
    console.log('\n✅ Regime Sentence (Driver + Behavior):');
    console.log(`   "${runtimeInput.regime_sentence || 'N/A'}"`);
    
    console.log('\n✅ Secondary Context:');
    if (runtimeInput.secondary_context && runtimeInput.secondary_context.length > 0) {
      runtimeInput.secondary_context.forEach(ctx => {
        console.log(`   • ${ctx}`);
      });
    } else {
      console.log('   N/A');
    }
    
    console.log('\n✅ Signal Stats:');
    if (runtimeInput.signal_stats) {
      console.log(`   Input: ${runtimeInput.signal_stats.input}`);
      console.log(`   Collapsed: ${runtimeInput.signal_stats.collapsed}`);
      console.log(`   Primary: ${runtimeInput.signal_stats.primary}`);
      console.log(`   Secondary: ${runtimeInput.signal_stats.secondary}`);
    } else {
      console.log('   N/A');
    }
    
    // 2. 生成報告
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 Market Digest 報告（套用 PATCH）');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const report = renderReport(runtimeInput);
    console.log(report);
    
    // 3. 儲存報告
    const outputPath = path.join(__dirname, 'data/runtime/market-digest-patch-test.txt');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, 'utf8');
    
    console.log(`\n💾 報告已儲存：${outputPath}`);
    
    // 4. 儲存 Runtime Input
    const runtimePath = path.join(__dirname, 'data/runtime/market-digest-patch-test.json');
    fs.writeFileSync(runtimePath, JSON.stringify(runtimeInput, null, 2), 'utf8');
    
    console.log(`💾 Runtime Input 已儲存：${runtimePath}`);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ 測試完成');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('❌ 測試失敗：', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testMarketDigestPatch();
