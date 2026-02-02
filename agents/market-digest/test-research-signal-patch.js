#!/usr/bin/env node
// 測試 RESEARCH_SIGNAL_UPGRADE_PATCH
// 生成升級後的報告

const fs = require('fs');
const path = require('path');
const { applyResearchSignalPatch } = require('./research-signal-upgrade-patch');

// 範例新聞（模擬真實財經新聞）
const sampleNews = [
  'Fed維持利率3.5%-3.75%不變，鮑爾重申數據依賴立場',
  '美元指數升破96，台幣貶至31.35',
  '台股加權指數收32536點，大跌1.2%，成交量縮至2800億',
  '美股S&P 500跌0.8%，Nasdaq重挫1.5%，科技股領跌',
  '黃金續創新高，突破5400美元，避險需求升溫',
  '原油回落至65美元，需求疑慮再起',
  '比特幣跌破58000美元，加密市場轉弱',
  '台積電ADR跌0.8%，市場關注2奈米進度',
  '微軟暴跌10%，雲端業務不如預期',
  'Meta大漲10.4%，AI營收超預期',
  '金管會：台股不再是淺碟市場，外資持續加碼',
  '中國經濟數據疲弱，製造業PMI連續6個月低於榮枯線',
  '川普關稅威脅再起，全球貿易緊張升溫',
  'VIX恐慌指數升至16.88，市場謹慎',
  '美國10年期公債殖利率升至3.85%，債市承壓',
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 RESEARCH_SIGNAL_UPGRADE_PATCH 測試');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`📌 輸入資料：${sampleNews.length} 則新聞\n`);

// 套用 patch
const result = applyResearchSignalPatch(sampleNews);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📈 生成報告');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 生成報告
const timestamp = new Date().toLocaleString('zh-TW', { 
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
});

let report = [];

report.push('📊 Research Signal Report');
report.push(`⏰ ${timestamp}`);
report.push('━━━━━━━━━━━━━━━━━━');
report.push('');

// Market Regime (REGIME_SENTENCE_RULE)
report.push('📈 Market Regime');
report.push(`• ${result.regimeSentence}`);
report.push('');

// Primary Signals (TOP 3)
report.push('🔴 Primary Signals (Top 3 by Macro Hierarchy)');
if (result.primarySignals.length > 0) {
  result.primarySignals.forEach((signal, idx) => {
    report.push(`${idx + 1}. ${signal}`);
  });
} else {
  report.push('• N/A');
}
report.push('');

// Secondary Context
if (result.secondaryContext.length > 0) {
  report.push('🔵 Secondary Context');
  result.secondaryContext.forEach(ctx => {
    report.push(`• ${ctx}`);
  });
  report.push('');
}

// Stats
report.push('📊 Statistics');
report.push(`• Input Events: ${result.stats.input}`);
report.push(`• After Theme Collapse: ${result.stats.collapsed}`);
report.push(`• Primary Signals: ${result.stats.primary}`);
report.push(`• Secondary Signals: ${result.stats.secondary}`);
report.push('');

report.push('━━━━━━━━━━━━━━━━━━');
report.push('✅ RESEARCH_SIGNAL_UPGRADE_PATCH 套用完成');

const reportText = report.join('\n');
console.log(reportText);

// 儲存報告
const outputPath = path.join(__dirname, 'data', 'runtime', 'research-signal-test-report.txt');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, reportText, 'utf8');

console.log(`\n💾 報告已儲存：${outputPath}`);

// 輸出 JSON（供後續使用）
const jsonOutput = {
  timestamp: new Date().toISOString(),
  ...result
};

const jsonPath = path.join(__dirname, 'data', 'runtime', 'research-signal-test.json');
fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2), 'utf8');

console.log(`💾 JSON 已儲存：${jsonPath}`);
