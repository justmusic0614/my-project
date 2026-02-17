// @deprecated 2026-02-17 - 舊版渲染器，已被 institutional-renderer.js 的 renderUnifiedMorningReport() 取代
// 將於穩定運行一週後刪除
//
// Clawbot Market Digest Renderer
// 根據 runtime input 生成制度化財經報告

function generateReport(runtimeInput) {
  const { report_metadata, normalized_market_summary, verified_key_data, narrative_states, health_components } = runtimeInput;
  
  const timestamp = new Date(report_metadata.generated_at).toLocaleString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  let report = [];
  
  // Header
  report.push('📊 市場日報');
  report.push(`⏰ ${timestamp}`);
  report.push(`🔔 重要性：${report_metadata.importance_level}`);
  report.push('━━━━━━━━━━━━━━━━━━');
  report.push('');
  
  // Daily Snapshot
  report.push('📌 每日快照');
  normalized_market_summary.forEach(item => {
    report.push(`• ${item}`);
  });
  report.push('');
  
  // Market Regime
  report.push('📈 市場概況');
  if (verified_key_data.tw_stock) {
    const tw = verified_key_data.tw_stock;
    const twSign = tw.taiex_change_pct >= 0 ? '▲' : '▼';
    report.push(`• 台股加權指數：${tw.taiex_close.toLocaleString()} ${twSign}${Math.abs(tw.taiex_change_pct)}%`);
    report.push(`• 成交量：${tw.volume_billion_twd.toLocaleString()} 億元`);
  }
  if (verified_key_data.us_stock) {
    const us = verified_key_data.us_stock;
    report.push(`• S&P 500：${us.sp500_close.toLocaleString()} (+${us.sp500_change_pct}%)`);
    report.push(`• Nasdaq：+${us.nasdaq_change_pct}%`);
  }
  if (verified_key_data.fx) {
    const fx = verified_key_data.fx;
    const fxSign = fx.usdtwd_change_pct >= 0 ? '貶' : '升';
    report.push(`• 台幣：${fx.usdtwd} (${fxSign}${Math.abs(fx.usdtwd_change_pct)}%)`);
  }
  report.push('');
  
  // Macro & Narrative
  report.push('🌐 宏觀主題');
  if (narrative_states.macro_theme) {
    report.push(`• ${narrative_states.macro_theme}`);
  }
  if (narrative_states.taiwan_focus) {
    report.push(`• 台灣焦點：${narrative_states.taiwan_focus}`);
  }
  if (narrative_states.risk_factors && narrative_states.risk_factors.length > 0) {
    report.push(`• 風險因素：${narrative_states.risk_factors.join('、')}`);
  }
  report.push('');
  
  // Health Status
  report.push('🔍 數據狀態');
  report.push(`• 總資料數：${health_components.total_materials}`);
  report.push(`• 已驗證：${health_components.verified_count}`);
  if (health_components.low_confidence_count > 0) {
    report.push(`• ⚠️ 低信心資料：${health_components.low_confidence_count}`);
  }
  if (health_components.missing_data_fields.length > 0) {
    report.push(`• 缺失欄位：${health_components.missing_data_fields.join('、')}`);
  }
  if (health_components.alerts.length > 0) {
    report.push(`• 🚨 警示：${health_components.alerts.join('、')}`);
  }
  report.push('');
  
  // Footer
  report.push('━━━━━━━━━━━━━━━━━━');
  report.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  report.push('📡 數據來源：TWSE、Yahoo Finance、Bloomberg');
  
  return report.join('\n');
}

// Test with example data
const fs = require('fs');
const runtimeInput = JSON.parse(fs.readFileSync('./example-runtime-input.json', 'utf8'));
const report = generateReport(runtimeInput);

console.log(report);
console.log('\n\n=== HEALTH STATUS ===\n');
console.log(`總資料數：${runtimeInput.health_components.total_materials}`);
console.log(`已驗證：${runtimeInput.health_components.verified_count}`);
console.log(`低信心資料：${runtimeInput.health_components.low_confidence_count}`);
console.log(`缺失欄位：${runtimeInput.health_components.missing_data_fields.join('、')}`);
