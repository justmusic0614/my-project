// Institutional Research Renderer
// 制度化晨報生成器

const RegimeTemplates = require('./backend/regime-templates');
const regimeTemplates = new RegimeTemplates();

function renderReport(runtimeInput) {
  const { 
    report_metadata, 
    section_bullets,
    primary_signals,
    secondary_context,
    regime_sentence,
    verified_key_data, 
    narrative_states, 
    health_components,
    risk_radar,
    signal_stats
  } = runtimeInput;

  // Confidence Control (選項 A：週末寬容)
  const confidenceLevel = report_metadata.confidence_level || 'MEDIUM';
  const isLowConfidence = confidenceLevel === 'LOW';
  
  // 週末檢查
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
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
  report.push(`🔔 Level: ${report_metadata.importance_level} | Confidence: ${confidenceLevel}`);
  
  // LOW confidence 才警示（週末 MEDIUM 不警示）
  if (isLowConfidence && !isWeekend) {
    report.push('⚠️ Data availability limited');
  }
  
  report.push('━━━━━━━━━━━━━━━━━━');
  report.push('');
  
  // Daily Snapshot (3-5 bullets)
  const dailyBullets = section_bullets.daily_snapshot || [];
  report.push('📌 Daily Snapshot');
  if (dailyBullets.length > 0) {
    dailyBullets.slice(0, 5).forEach(bullet => {
      report.push(`• ${bullet}`);
    });
  } else {
    report.push('• N/A');
  }
  report.push('');
  
  // Market Regime (RESEARCH_SIGNAL_UPGRADE_PATCH: Driver + Market Behavior)
  report.push('📈 Market Regime');
  
  // 優先使用 PATCH 的 regime_sentence（Driver + Behavior）
  if (regime_sentence) {
    report.push(`• ${regime_sentence}`);
  } else {
    // Fallback: 使用舊模板
    const fallbackRegime = regimeTemplates.select(verified_key_data, narrative_states);
    report.push(`• ${fallbackRegime}`);
  }
  report.push('');
  
  // Key Data
  // 台股
  if (verified_key_data.tw_stock) {
    const tw = verified_key_data.tw_stock;
    const close = tw.taiex_close !== null ? tw.taiex_close.toLocaleString() : 'N/A';
    // % change: N/A if unknown (never 0.00%)
    let change = 'N/A';
    if (tw.taiex_change_pct !== null && tw.taiex_change_pct !== 0) {
      change = `${tw.taiex_change_pct > 0 ? '+' : ''}${tw.taiex_change_pct}%`;
    } else if (tw.taiex_change_pct === 0 && tw.as_of === 'DELAYED') {
      change = 'N/A'; // 週末延遲視為 N/A
    } else if (tw.taiex_change_pct === 0) {
      change = '0%'; // 真的 0
    }
    
    // 成交量顯示：numeric or N/A (never "weekend")
    let volumeStr = 'N/A';
    if (tw.volume_billion_twd !== null && tw.volume_billion_twd > 0) {
      volumeStr = `${tw.volume_billion_twd.toLocaleString()}bn`;
    }
    
    report.push(`• TAIEX: ${close} ${change} | Vol: ${volumeStr} | ${tw.as_of} [${tw.confidence_tier}]`);
    
    if (tw.ma5 !== null && tw.ma20 !== null && tw.rsi !== null) {
      report.push(`  MA5: ${tw.ma5} | MA20: ${tw.ma20} | RSI: ${tw.rsi}`);
    }
  }
  
  // 美股
  if (verified_key_data.us_stock) {
    const us = verified_key_data.us_stock;
    const sp500 = us.sp500_close !== null ? us.sp500_close.toLocaleString() : 'N/A';
    const spChange = us.sp500_change_pct !== null ? `${us.sp500_change_pct > 0 ? '+' : ''}${us.sp500_change_pct}%` : 'N/A';
    const nqChange = us.nasdaq_change_pct !== null ? `${us.nasdaq_change_pct > 0 ? '+' : ''}${us.nasdaq_change_pct}%` : 'N/A';
    
    report.push(`• S&P 500: ${sp500} ${spChange} | Nasdaq: ${nqChange} | ${us.as_of} [${us.confidence_tier}]`);
  }
  
  // 匯率
  if (verified_key_data.fx) {
    const fx = verified_key_data.fx;
    const rate = fx.usdtwd !== null ? fx.usdtwd.toFixed(2) : 'N/A';
    const change = fx.usdtwd_change_pct !== null ? `${fx.usdtwd_change_pct > 0 ? '+' : ''}${fx.usdtwd_change_pct}%` : 'N/A';
    
    report.push(`• USD/TWD: ${rate} ${change} | ${fx.as_of} [${fx.confidence_tier}]`);
  }
  
  report.push('');
  
  // PRIMARY SIGNALS (RESEARCH_SIGNAL_UPGRADE_PATCH: Top 3 by Macro Hierarchy)
  if (primary_signals && primary_signals.length > 0) {
    report.push('🔴 Primary Signals (Top 3 by Macro Impact)');
    primary_signals.forEach((signal, idx) => {
      report.push(`${idx + 1}. ${signal}`);
    });
    report.push('');
  }
  
  // SECONDARY CONTEXT (Supporting signals)
  if (secondary_context && secondary_context.length > 0) {
    report.push('🔵 Secondary Context');
    secondary_context.forEach(ctx => {
      report.push(`• ${ctx}`);
    });
    report.push('');
  }
  
  // Macro & Policy (0-3 bullets)
  report.push('🌐 Macro & Policy');
  const macroBullets = section_bullets.macro_policy || [];
  if (macroBullets.length > 0) {
    macroBullets.slice(0, 3).forEach(bullet => {
      report.push(`• ${bullet}`);
    });
  } else {
    report.push('• N/A');
  }
  report.push('');
  
  // Equity Market Structure (0-3 bullets)
  report.push('📊 Equity Market Structure');
  const equityBullets = section_bullets.equity_market || [];
  if (equityBullets.length > 0) {
    equityBullets.slice(0, 3).forEach(bullet => {
      report.push(`• ${bullet}`);
    });
  } else {
    report.push('• N/A');
  }
  report.push('');
  
  // Cross Asset Signals (3-5 bullets)
  report.push('💱 Cross Asset Signals');
  const crossAssetBullets = section_bullets.cross_asset || [];
  if (crossAssetBullets.length > 0) {
    crossAssetBullets.slice(0, 5).forEach(bullet => {
      report.push(`• ${bullet}`);
    });
  } else {
    report.push('• N/A');
  }
  report.push('');
  
  // Taiwan Market (0-3 bullets)
  report.push('🇹🇼 Taiwan Market');
  const taiwanBullets = section_bullets.taiwan_market || [];
  if (taiwanBullets.length > 0) {
    taiwanBullets.slice(0, 3).forEach(bullet => {
      report.push(`• ${bullet}`);
    });
  } else {
    report.push('• N/A');
  }
  report.push('');
  
  // Event Watch (0-3 bullets)
  report.push('📅 Event Watch');
  report.push('• N/A'); // 未來擴充
  report.push('');
  
  // Risk Radar (CRITICAL 等級 + HIGH confidence 才輸出)
  if (risk_radar && !isLowConfidence) {
    report.push('⚠️ Risk Radar');
    report.push(`• Trigger: ${risk_radar.trigger}`);
    report.push(`• Immediate Reaction: ${risk_radar.immediate_reaction}`);
    report.push(`• Key Uncertainty: ${risk_radar.key_uncertainty}`);
    report.push('');
  }
  
  // System Health
  report.push('🔍 System Health');
  
  if (health_components.missing_data_fields.length > 0) {
    report.push(`• Missing Fields: ${health_components.missing_data_fields.join(', ')}`);
  } else {
    report.push(`• Missing Fields: None`);
  }
  
  const dist = health_components.confidence_tier_distribution;
  report.push(`• Confidence Distribution: A:${dist.A} B:${dist.B} C:${dist.C} D:${dist.D}`);
  
  if (health_components.external_data_status.length > 0) {
    report.push(`• External Data: ${health_components.external_data_status.join('; ')}`);
  }
  
  // OCR Summary
  report.push(`• OCR: not implemented`);
  
  // Signal Stats (RESEARCH_SIGNAL_UPGRADE_PATCH)
  if (signal_stats) {
    report.push(`• Signal Stats: Input:${signal_stats.input} → Collapsed:${signal_stats.collapsed} → Primary:${signal_stats.primary} | Secondary:${signal_stats.secondary}`);
  }
  
  if (health_components.alerts.length > 0) {
    report.push(`• Alerts:`);
    health_components.alerts.forEach(alert => {
      report.push(`  - ${alert}`);
    });
  } else {
    report.push(`• Alerts: None`);
  }
  
  report.push('');
  
  // Footer
  report.push('━━━━━━━━━━━━━━━━━━');
  report.push('免責聲明：本報告僅供資訊參考，不構成投資建議');
  report.push('Data: TWSE | Yahoo Finance | Bloomberg');
  
  return report.join('\n');
}

module.exports = { renderReport };
