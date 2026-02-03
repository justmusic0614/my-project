#!/usr/bin/env node
// Clawbot Market Digest Agent
// Telegram 指令介面

const fs = require('fs');
const path = require('path');
const MarketDataFetcher = require('./backend/fetcher');
const RuntimeInputGenerator = require('./backend/runtime-gen');

// 載入設定
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 狀態管理
let lastGeneratedReport = null;
let approvalPending = false;

// 主要指令處理
async function handleCommand(command, args = []) {
  switch (command) {
    case '/fetch':
      return await fetchNews();
    
    case '/run':
      return await generateReport();
    
    case '/preview':
      const full = args.includes('full');
      return await previewReport(full);
    
    case '/approve':
      return await approveReport();
    
    case '/status':
      return await showStatus();
    
    default:
      return getHelpMessage();
  }
}

async function fetchNews() {
  const fetcher = new MarketDataFetcher(config);
  const result = await fetcher.fetchAllNews();
  
  return `📰 新聞抓取完成

總數：${result.total}
新增：${result.new}
快取：${result.cached}

使用 /run 生成報告`;
}

async function generateReport() {
  try {
    const generator = new RuntimeInputGenerator(config);
    const runtimeInput = await generator.generate();
    
    // 使用 renderer 生成報告
    const report = generateReportFromRuntime(runtimeInput);
    
    lastGeneratedReport = {
      runtimeInput: runtimeInput,
      report: report,
      generatedAt: new Date().toISOString()
    };
    
    approvalPending = true;
    
    return `✅ 報告已生成

重要性：${runtimeInput.report_metadata.importance_level}
新聞數：${runtimeInput.health_components.total_materials}

使用 /preview 預覽報告
使用 /approve 確認推播`;
    
  } catch (err) {
    return `❌ 生成失敗：${err.message}`;
  }
}

async function previewReport(full = false) {
  if (!lastGeneratedReport) {
    return '⚠️ 尚未生成報告，請先執行 /run';
  }

  const { report, runtimeInput } = lastGeneratedReport;
  
  if (full) {
    return `📊 完整報告預覽

${report}

━━━━━━━━━━━━━━━━━━
使用 /approve 確認推播`;
  } else {
    // 簡短預覽
    const lines = report.split('\n');
    const preview = lines.slice(0, 20).join('\n');
    
    return `📊 報告預覽（簡短版）

${preview}

...（共 ${lines.length} 行）

使用 /preview full 查看完整報告
使用 /approve 確認推播`;
  }
}

async function approveReport() {
  if (!approvalPending) {
    return '⚠️ 無待審核報告';
  }

  const { report } = lastGeneratedReport;
  
  approvalPending = false;
  
  // 這裡會由 Clawdbot 主系統處理推播
  // 現階段直接返回報告
  return `✅ 報告已批准

${report}`;
}

async function showStatus() {
  const fetcher = new MarketDataFetcher(config);
  const recentNews = fetcher.getRecentNews(24);
  
  const cacheFile = path.join(__dirname, 'data/cache/news-raw.json');
  const cache = fetcher.loadCache(cacheFile);
  
  return `📊 系統狀態

快取新聞：${cache.length} 則
24h 內新聞：${recentNews.length} 則
待審核報告：${approvalPending ? '是' : '否'}

數據源狀態：
${config.data_sources.tw_news.filter(s => s.enabled).map(s => `  ✅ ${s.name}`).join('\n')}
${config.data_sources.intl_news.filter(s => s.enabled).map(s => `  ✅ ${s.name}`).join('\n')}

使用 /fetch 抓取最新新聞
使用 /run 生成報告`;
}

function getHelpMessage() {
  return `📖 Clawbot Market Digest Agent

指令列表：
/fetch - 抓取最新新聞
/run - 生成報告（使用快取新聞）
/preview - 預覽報告（簡短版）
/preview full - 預覽完整報告
/approve - 確認並推播報告
/status - 查看系統狀態

工作流程：
1. /fetch 抓取新聞
2. /run 生成報告
3. /preview 檢視
4. /approve 推播`;
}

// 報告生成邏輯（使用 Institutional Renderer）
const { renderReport } = require('./institutional-renderer');

function generateReportFromRuntime(runtimeInput) {
  return renderReport(runtimeInput);
}

// 舊版 renderer（已棄用）
function generateReportFromRuntime_DEPRECATED(runtimeInput) {
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
  
  report.push('📊 市場日報');
  report.push(`⏰ ${timestamp}`);
  report.push(`🔔 重要性：${report_metadata.importance_level}`);
  report.push('━━━━━━━━━━━━━━━━━━');
  report.push('');
  
  report.push('📌 每日快照');
  normalized_market_summary.forEach(item => {
    report.push(`${item}`);
  });
  report.push('');
  
  report.push('📈 市場概況');
  if (verified_key_data.tw_stock) {
    const tw = verified_key_data.tw_stock;
    const twSign = tw.taiex_change_pct >= 0 ? '▲' : '▼';
    report.push(`• 台股加權指數：${tw.taiex_close.toLocaleString()} ${twSign}${Math.abs(tw.taiex_change_pct)}%`);
    report.push(`• 成交量：${tw.volume_billion_twd.toLocaleString()} 億元`);
    if (tw.ma5) report.push(`• MA5：${tw.ma5} | MA20：${tw.ma20} | RSI：${tw.rsi}`);
  }
  if (verified_key_data.us_stock) {
    const us = verified_key_data.us_stock;
    report.push(`• S&P 500：${us.sp500_close.toLocaleString()} (+${us.sp500_change_pct}%)`);
    if (us.nasdaq_change_pct) report.push(`• Nasdaq：+${us.nasdaq_change_pct}%`);
  }
  if (verified_key_data.fx) {
    const fx = verified_key_data.fx;
    const fxSign = fx.usdtwd_change_pct >= 0 ? '貶' : '升';
    report.push(`• 台幣：${fx.usdtwd} (${fxSign}${Math.abs(fx.usdtwd_change_pct)}%)`);
  }
  report.push('');
  
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
  
  report.push('━━━━━━━━━━━━━━━━━━');
  report.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  report.push('📡 數據來源：TWSE、Yahoo Finance、Bloomberg');
  
  return report.join('\n');
}

// CLI 模式（用於測試）
if (require.main === module) {
  const command = process.argv[2] || '/help';
  const args = process.argv.slice(3);
  
  handleCommand(command, args).then(result => {
    console.log(result);
  }).catch(err => {
    console.error('錯誤:', err);
  });
}

module.exports = { handleCommand };
