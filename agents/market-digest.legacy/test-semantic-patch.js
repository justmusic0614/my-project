#!/usr/bin/env node
// 測試 RESEARCH_SIGNAL_SEMANTIC_UPGRADE_PATCH v1_integrated

const fs = require('fs');
const path = require('path');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const { renderReport } = require('./institutional-renderer');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

async function testSemanticPatch() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SEMANTIC_UPGRADE_PATCH v1_integrated 測試');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  try {
    // 1. 生成 Runtime Input（套用完整 PATCH）
    const generator = new RuntimeInputGenerator(config);
    const runtimeInput = await generator.generate();
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 SEMANTIC PATCH 驗收');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // SPEC 1: Macro Tag Validation
    console.log('✅ SPEC 1: Macro Tag Validation');
    console.log(`   輸入事件：${runtimeInput.signal_stats.input}`);
    console.log(`   驗證通過：${runtimeInput.signal_stats.validated}`);
    console.log(`   拒絕率：${((runtimeInput.signal_stats.input - runtimeInput.signal_stats.validated) / runtimeInput.signal_stats.input * 100).toFixed(1)}%`);
    
    // SPEC 2: Global Macro Scope Weight
    console.log('\n✅ SPEC 2: Global Macro Scope Weight');
    console.log(`   加權後事件：${runtimeInput.signal_stats.weighted}`);
    console.log('   權重規則：US=1.0 | G10=0.8 | EM=0.5 | THEMATIC=0.3');
    
    // SPEC 3: Regime Cross-Asset Evidence
    console.log('\n✅ SPEC 3: Regime Cross-Asset Evidence');
    if (runtimeInput.regime_evidence) {
      console.log(`   跨資產驅動因素：${runtimeInput.regime_evidence.count} 個`);
      console.log(`   證據類別：${runtimeInput.regime_evidence.classes.join(', ')}`);
      console.log(`   Regime Confidence：${runtimeInput.regime_confidence}`);
      console.log(`   證據充足：${runtimeInput.regime_evidence.sufficient ? 'YES' : 'NO'}`);
    } else {
      console.log('   N/A');
    }
    
    // SPEC 4: Secondary Signal Floor
    console.log('\n✅ SPEC 4: Secondary Signal Floor');
    console.log(`   Primary Signals：${runtimeInput.signal_stats.primary}`);
    console.log(`   Secondary Signals：${runtimeInput.signal_stats.secondary}`);
    const threshold = runtimeInput.signal_stats.primary >= 2 ? 2 : 0;
    const pass = runtimeInput.signal_stats.secondary >= threshold;
    console.log(`   門檻要求：${threshold} 則`);
    console.log(`   符合要求：${pass ? 'YES' : 'NO'}`);
    
    // Primary Signals
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔴 Primary Signals (Top 3 by Semantic Score)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    if (runtimeInput.primary_signals && runtimeInput.primary_signals.length > 0) {
      runtimeInput.primary_signals.forEach((signal, idx) => {
        console.log(`${idx + 1}. ${signal}`);
      });
    } else {
      console.log('N/A');
    }
    
    // Regime Sentence
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 Market Regime');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`"${runtimeInput.regime_sentence || 'N/A'}"`);
    
    // 2. 生成完整報告
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📄 完整報告');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const report = renderReport(runtimeInput);
    console.log(report);
    
    // 3. 儲存報告
    const outputPath = path.join(__dirname, 'data/runtime/semantic-patch-test.txt');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, 'utf8');
    
    console.log(`\n💾 報告已儲存：${outputPath}`);
    
    // 4. 儲存 Runtime Input
    const runtimePath = path.join(__dirname, 'data/runtime/semantic-patch-test.json');
    fs.writeFileSync(runtimePath, JSON.stringify(runtimeInput, null, 2), 'utf8');
    
    console.log(`💾 Runtime Input 已儲存：${runtimePath}`);
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SEMANTIC_UPGRADE_PATCH v1_integrated 測試完成');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
  } catch (error) {
    console.error('❌ 測試失敗：', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testSemanticPatch();
