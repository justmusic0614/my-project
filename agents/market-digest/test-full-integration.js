#!/usr/bin/env node
// 完整測試：套用 RESEARCH_SIGNAL_UPGRADE_PATCH 到整合報告

const fs = require('fs');
const path = require('path');
const { applyResearchSignalPatch } = require('./research-signal-upgrade-patch');

// 模擬 LINE 早報新聞（範例資料）
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

// 模擬市場數據
const mockMarketData = {
  tw_stock: { index: 32536, change: -1.2, volume: 2800 },
  us_stock: { sp500: 6969, nasdaq: 23685, dow: 43200 },
  fx: { usdtwd: 31.35, dxy: 96.17 },
  commodities: { gold: 5400, oil: 65 },
  vix: 16.88
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 完整整合測試（RESEARCH_SIGNAL_UPGRADE_PATCH）');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 套用 patch
const patchResult = applyResearchSignalPatch(sampleNews);

// 生成報告
const timestamp = new Date().toLocaleString('zh-TW', { 
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit'
});

let report = [];

report.push('🌅 每日財經匯總（Research Signal 升級版）');
report.push(`📅 ${timestamp}`);
report.push('━━━━━━━━━━━━━━━━━━');
report.push('');

// 市場數據
report.push('📈 市場概況');
report.push('');
const tw = mockMarketData.tw_stock;
const sign = tw.change >= 0 ? '▲' : '▼';
report.push(`• 台股加權指數：${tw.index.toLocaleString()} ${sign}${Math.abs(tw.change)}%`);
report.push(`  成交量：${tw.volume.toLocaleString()} 億元`);
report.push(`• S&P 500：${mockMarketData.us_stock.sp500.toLocaleString()}`);
report.push(`• Nasdaq：${mockMarketData.us_stock.nasdaq.toLocaleString()}`);
report.push(`• 台幣：${mockMarketData.fx.usdtwd}`);
report.push(`• 美元指數：${mockMarketData.fx.dxy}`);
report.push(`• 黃金：$${mockMarketData.commodities.gold.toLocaleString()}/oz`);
report.push(`• 原油：$${mockMarketData.commodities.oil}/barrel`);
report.push(`• VIX 恐慌指數：${mockMarketData.vix}`);
report.push('');

// Market Regime
report.push('🔍 市場狀態');
report.push('');
report.push(`• ${patchResult.regimeSentence}`);
report.push('');

// Primary Signals (TOP 3)
report.push('🔴 主要訊號（Research Signal - Top 3）');
report.push('');
if (patchResult.primarySignals.length > 0) {
  patchResult.primarySignals.forEach((signal, idx) => {
    report.push(`${idx + 1}. ${signal}`);
  });
} else {
  report.push('• N/A');
}
report.push('');

// Secondary Context
if (patchResult.secondaryContext && patchResult.secondaryContext.length > 0) {
  report.push('🔵 補充訊號');
  report.push('');
  patchResult.secondaryContext.forEach(ctx => {
    report.push(`• ${ctx}`);
  });
  report.push('');
}

// Stats
report.push('📊 訊號統計');
report.push('');
report.push(`• 輸入事件：${patchResult.stats.input} 則`);
report.push(`• 主題合併後：${patchResult.stats.collapsed} 則`);
report.push(`• Primary Signals：${patchResult.stats.primary} 則`);
report.push(`• Secondary Signals：${patchResult.stats.secondary} 則`);
report.push('');

// Footer
report.push('━━━━━━━━━━━━━━━━━━');
report.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
report.push('📡 數據來源：LINE 群組 + TWSE + Yahoo Finance + Bloomberg');

const reportText = report.join('\n');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 整合報告');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log(reportText);

// 儲存報告
const outputPath = path.join(__dirname, 'data', 'runtime', 'full-integration-test.txt');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, reportText, 'utf8');

console.log(`\n💾 報告已儲存：${outputPath}`);
