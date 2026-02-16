#!/usr/bin/env node
// 測試 Risk-off Analyzer 和 Sector Analyzer 整合

const path = require('path');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const { renderReport } = require('./institutional-renderer');
const fs = require('fs');

async function testNewFeatures() {
  console.log('🔬 測試 Risk-off & Sector Analysis 整合...\n');

  try {
    // 讀取配置
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // 生成 runtime input
    console.log('1️⃣ 生成 Runtime Input...');
    const generator = new RuntimeInputGenerator(config);
    const runtimeInput = await generator.generate();
    
    console.log('✅ Runtime Input 生成完成');
    console.log(`   - 日期: ${runtimeInput.date || 'N/A'}`);
    console.log(`   - 新聞數: ${runtimeInput.health_components?.total_materials || 0}`);

    // 檢查是否包含新功能
    console.log('\n2️⃣ 檢查新功能整合...');
    if (runtimeInput.risk_off_analysis) {
      console.log('✅ Risk-off Analysis 已整合');
      console.log(`   - Score: ${runtimeInput.risk_off_analysis.score}/100`);
      console.log(`   - Level: ${runtimeInput.risk_off_analysis.level}`);
      console.log(`   - Signal: ${runtimeInput.risk_off_analysis.signal}`);
    } else {
      console.log('❌ Risk-off Analysis 未找到');
    }

    if (runtimeInput.sector_analysis) {
      console.log('✅ Sector Analysis 已整合');
      if (runtimeInput.sector_analysis.rotation) {
        console.log(`   - Signal: ${runtimeInput.sector_analysis.signal}`);
        console.log(`   - Spread: ${runtimeInput.sector_analysis.rotation.spread}%`);
      } else if (runtimeInput.sector_analysis.newsSentiment) {
        console.log(`   - News Sentiment: ${runtimeInput.sector_analysis.newsSentiment.sentiment}`);
      }
    } else {
      console.log('❌ Sector Analysis 未找到');
    }

    // 生成報告
    console.log('\n3️⃣ 生成報告...');
    const report = renderReport(runtimeInput);
    
    // 檢查報告內容
    const hasRiskOff = report.includes('🔴 Risk-off Analysis') || report.includes('Risk-off');
    const hasSector = report.includes('📊 Sector Rotation') || report.includes('📊 Sector Sentiment');
    
    console.log('✅ 報告生成完成');
    console.log(`   - 包含 Risk-off Analysis: ${hasRiskOff ? '✅' : '❌'}`);
    console.log(`   - 包含 Sector Analysis: ${hasSector ? '✅' : '❌'}`);
    console.log(`   - 報告長度: ${report.length} 字元`);

    // 儲存報告
    const outputDir = path.join(__dirname, 'data/output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const reportPath = path.join(outputDir, 'test-new-features-report.txt');
    fs.writeFileSync(reportPath, report, 'utf8');
    
    console.log(`\n💾 報告已儲存至: ${reportPath}`);
    
    // 顯示 Risk-off 和 Sector 部分
    console.log('\n📊 報告預覽（Risk-off & Sector 部分）:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const lines = report.split('\n');
    let inRiskOffSection = false;
    let inSectorSection = false;
    let sectionLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.includes('🔴 Risk-off Analysis')) {
        inRiskOffSection = true;
        sectionLines.push(line);
      } else if (line.includes('📊 Sector')) {
        inSectorSection = true;
        sectionLines.push(line);
      } else if ((inRiskOffSection || inSectorSection) && line.trim() === '') {
        inRiskOffSection = false;
        inSectorSection = false;
        sectionLines.push('');
      } else if (inRiskOffSection || inSectorSection) {
        sectionLines.push(line);
      }
    }
    
    if (sectionLines.length > 0) {
      console.log(sectionLines.join('\n'));
    } else {
      console.log('⚠️ 未找到 Risk-off 或 Sector 分析區塊');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n✅ 測試完成！');

  } catch (error) {
    console.error('❌ 測試失敗:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testNewFeatures();
