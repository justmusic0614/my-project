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
    regime_confidence,
    regime_evidence,
    verified_key_data,
    narrative_states,
    health_components,
    risk_radar,
    risk_off_analysis,  // 新增
    sector_analysis,     // 新增
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
    
    // 顯示跨資產證據（SEMANTIC_UPGRADE_PATCH）
    if (regime_evidence) {
      const evidenceStr = regime_evidence.classes.join(', ');
      report.push(`  Cross-Asset Evidence: ${regime_evidence.count}/${regime_evidence.classes.length} drivers (${evidenceStr})`);
    }
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

  // Risk-off Analysis (新增)
  if (risk_off_analysis) {
    report.push('🔴 Risk-off Analysis');
    report.push(`• Score: ${risk_off_analysis.score}/100 ${risk_off_analysis.signal} (${risk_off_analysis.level})`);
    report.push(`• ${risk_off_analysis.description}`);
    report.push(`• Recommendation: ${risk_off_analysis.recommendation}`);

    // 分項評分
    const b = risk_off_analysis.breakdown;
    report.push(`• Breakdown: VIX ${b.vix.value} (${b.vix.contribution}pts) | Gold ${b.safeHaven.gold.toFixed(1)}% (${b.safeHaven.contribution}pts) | Foreign ${b.foreignFlow.value} (${b.foreignFlow.contribution}pts)`);
    report.push('');
  }

  // Sector Rotation Analysis (新增)
  if (sector_analysis && sector_analysis.rotation) {
    report.push('📊 Sector Rotation');
    report.push(`• ${sector_analysis.signal}`);
    report.push(`• Spread: ${sector_analysis.rotation.spread}% (Defensive ${sector_analysis.rotation.defensiveAvg}% vs Cyclical ${sector_analysis.rotation.cyclicalAvg}%)`);
    report.push(`• Confidence: ${sector_analysis.rotation.confidence}`);
    report.push(`• ${sector_analysis.recommendation}`);
    report.push('');
  } else if (sector_analysis && sector_analysis.newsSentiment) {
    // 如果沒有板塊數據，顯示從新聞推測的情緒
    const s = sector_analysis.newsSentiment;
    report.push('📊 Sector Sentiment (from news)');
    report.push(`• ${s.sentiment} (Defensive: ${s.defensiveMentions} | Cyclical: ${s.cyclicalMentions})`);
    report.push(`• Confidence: ${s.confidence}`);
    report.push('');
  }

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

/**
 * 統一晨報渲染器
 * 整合 smart-integrator 全部資料源 + daily-brief 分析區塊
 * @param {Object} data - 所有整合後的資料
 * @param {string} level - 'minimal' | 'standard' | 'full'
 * @param {Object} sectionConfig - 區塊權重與字元上限設定
 */
function renderUnifiedMorningReport(data, level = 'standard', sectionConfig = {}) {
  const {
    lineMarketData, finalNews, marketDigest, marketRegime, secondaryContext,
    allText, uniqueLineNews, aiNews, pipelineData, watchlistRadar,
    twoStageSummary, analyticalSections
  } = data;

  const maxChars = sectionConfig.maxChars || { minimal: 800, standard: 3800, full: 10000 };
  const charLimit = maxChars[level] || 3800;

  if (level === 'full') {
    return renderFullReport(data);
  }

  const lines = [];
  const now = new Date();
  const dateStr = now.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  });
  const timeStr = now.toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit'
  });

  if (level === 'minimal') {
    return renderMinimalReport(data, dateStr, timeStr);
  }

  // === Standard 報告 ===
  lines.push('📌 每日金融摘要');
  lines.push(`📅 ${dateStr} ${timeStr}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');

  // [P0] AI 快摘
  if (twoStageSummary && !twoStageSummary.skipped && twoStageSummary.brief30s) {
    lines.push('⚡ AI 快摘');
    lines.push('');
    twoStageSummary.brief30s.split('\n').slice(0, 4).forEach(l => {
      if (l.trim()) lines.push(l.trim());
    });
    lines.push('');
  }

  // [P0] 市場數據
  lines.push('📈 市場數據');
  lines.push('');
  renderMarketDataSection(lines, lineMarketData, marketDigest);
  lines.push('');

  // [P0] 市場體制（合併 ResearchSignalPatch + DailyBrief 分析）
  if (marketRegime || (analyticalSections && analyticalSections.marketRegime)) {
    lines.push('🔍 市場體制');
    lines.push('');
    if (marketRegime) {
      lines.push(`• ${marketRegime}`);
    }
    if (analyticalSections && analyticalSections.marketRegime) {
      const regime = analyticalSections.marketRegime;
      if (regime.flow && !marketRegime?.includes(regime.flow)) {
        lines.push(`• ${regime.flow}`);
      }
      if (regime.implication) {
        lines.push(`  ▸ ${regime.implication}`);
      }
    }
    lines.push('');
  }

  // [P0] 主要信號
  if (finalNews && finalNews.length > 0) {
    lines.push('🔴 主要信號（Top 3）');
    lines.push('');
    finalNews.slice(0, 3).forEach((news, i) => {
      lines.push(`${i + 1}. ${news}`);
    });
    lines.push('');
  }

  // 檢查字元預算
  if (lines.join('\n').length > charLimit) {
    return appendFooter(lines);
  }

  // [P1] 焦點事件（AI 精選新聞）
  if (aiNews && aiNews.top.length > 0) {
    lines.push('📰 焦點事件');
    lines.push('');
    aiNews.top.slice(0, 5).forEach((item, i) => {
      const score = item.analysis.importance;
      const icon = score >= 10 ? '🔴' : score >= 8 ? '🟡' : '🟢';
      const title = item.title.length > 50 ? item.title.substring(0, 50) + '...' : item.title;
      lines.push(`${i + 1}. ${icon}[${score}] ${title}`);
      if (item.analysis.marketImplication) {
        const impl = item.analysis.marketImplication.length > 45
          ? item.analysis.marketImplication.substring(0, 45) + '...'
          : item.analysis.marketImplication;
        lines.push(`   ▸ ${impl}`);
      }
    });
    lines.push('');
  }

  // [P1] 持股雷達
  if (watchlistRadar && watchlistRadar.stocks && watchlistRadar.stocks.length > 0) {
    lines.push(`🎯 持股雷達 | ${watchlistRadar.date || now.toISOString().split('T')[0]}`);
    lines.push('');
    watchlistRadar.stocks.forEach((stock, i) => {
      const score = stock.analysis ? stock.analysis.score : 50;
      const recIcon = score >= 65 ? '🟢' : score <= 35 ? '🔴' : '➖';
      lines.push(`${i + 1}. ${stock.code} ${stock.name} [${recIcon} ${score}分]`);
      if (stock.chip && stock.chip.stock) {
        const s = stock.chip.stock;
        const sign = s.change >= 0 ? '▲' : '▼';
        lines.push(`   💹 ${s.closingPrice}元 (${sign}${Math.abs(s.change)}) | 量 ${s.volume ? (s.volume / 1000).toFixed(0) : 'N/A'}張`);
      }
      if (stock.chip && stock.chip.institutional) {
        const inst = stock.chip.institutional;
        const fSign = inst.foreign >= 0 ? '買超' : '賣超';
        const fVal = Math.abs(inst.foreign / 1000).toFixed(0);
        lines.push(`   📌 外資${fSign} ${fVal}張 | 投信${((inst.trust || 0) >= 0 ? '+' : '')}${((inst.trust || 0) / 1000).toFixed(0)}`);
      }
      if (stock.analysis && stock.analysis.recommendation !== 'neutral') {
        lines.push(`   ▶ ${stock.analysis.recommendationMessage}`);
      }
    });
    lines.push('');
  }

  if (lines.join('\n').length > charLimit) {
    return appendFooter(lines);
  }

  // [P2] 總經與政策
  if (analyticalSections && analyticalSections.macroPolicy) {
    const macro = analyticalSections.macroPolicy;
    lines.push('🌐 總經與政策');
    lines.push('');
    if (macro.keyData) {
      lines.push(`• US 10Y: ${macro.keyData.us10y} | DXY: ${macro.keyData.dxy} | VIX: ${macro.keyData.vix}`);
    }
    if (macro.focus && macro.focus.length > 0) {
      macro.focus.slice(0, 2).forEach(f => {
        const short = f.length > 50 ? f.substring(0, 50) + '...' : f;
        lines.push(`• ${short}`);
      });
    }
    if (macro.implication) {
      lines.push(`  ▸ ${macro.implication}`);
    }
    lines.push('');
  }

  // [P2] 跨資產信號
  if (analyticalSections && analyticalSections.crossAsset) {
    const ca = analyticalSections.crossAsset;
    lines.push('💱 跨資產信號');
    lines.push('');
    if (ca.commodities) {
      lines.push(`• 黃金：${ca.commodities.gold} | 原油：${ca.commodities.oil} | 銅：${ca.commodities.copper}`);
    }
    if (ca.fxRates) {
      lines.push(`• 美元：${ca.fxRates.usd} | 殖利率：${ca.fxRates.us10y} | 台幣：${ca.fxRates.twd}`);
    }
    if (ca.implication) {
      lines.push(`  ▸ ${ca.implication}`);
    }
    lines.push('');
  }

  // [P2] 台股聚焦
  if (analyticalSections && analyticalSections.taiwanMarket) {
    const tw = analyticalSections.taiwanMarket;
    lines.push('🇹🇼 台股聚焦');
    lines.push('');
    lines.push(`• ${tw.index} | ${tw.volume} | ${tw.foreign}`);
    if (tw.trend) lines.push(`• ${tw.trend}`);
    if (tw.implication) lines.push(`  ▸ ${tw.implication}`);
    lines.push('');
  }

  if (lines.join('\n').length > charLimit) {
    return appendFooter(lines);
  }

  // [P3] 補充訊號
  if (secondaryContext && secondaryContext.length > 0) {
    lines.push('🔵 補充訊號');
    lines.push('');
    secondaryContext.slice(0, 3).forEach(ctx => lines.push(`• ${ctx}`));
    lines.push('');
  }

  // [P3] Perplexity 研究
  if (pipelineData && pipelineData.news.perplexity.length > 0) {
    lines.push('🔬 Perplexity 研究');
    lines.push('');
    pipelineData.news.perplexity.slice(0, 3).forEach((news, i) => {
      const title = news.title.length > 55 ? news.title.substring(0, 55) + '...' : news.title;
      lines.push(`${i + 1}. ${title}`);
    });
    lines.push('');
  }

  // [P3] 事件日曆
  if (analyticalSections && analyticalSections.eventCalendar && analyticalSections.eventCalendar.length > 0) {
    lines.push('📅 事件日曆');
    lines.push('');
    analyticalSections.eventCalendar.forEach(e => lines.push(`• ${e}`));
    lines.push('');
  }

  // 成本摘要
  if (pipelineData && pipelineData.costSummary) {
    lines.push(pipelineData.costSummary);
  }

  return appendFooter(lines);
}

/**
 * Minimal 報告（~200 字推播用）
 */
function renderMinimalReport(data, dateStr, timeStr) {
  const { lineMarketData, finalNews, marketDigest, marketRegime, aiNews, twoStageSummary } = data;
  const lines = [];

  lines.push(`🌅 ${dateStr} ${timeStr}`);
  lines.push('━━━━━━━━━━━━━━━━━━');

  // 市場數據（單行）
  const marketParts = [];
  if (lineMarketData.tw_stock) {
    const tw = lineMarketData.tw_stock;
    const sign = tw.change >= 0 ? '▲' : '▼';
    const pct = marketDigest?.verified_key_data?.tw_stock?.taiex_change_pct || 'N/A';
    marketParts.push(`台股 ${sign}${pct}%`);
  }
  if (lineMarketData.us_stock.sp500 || marketDigest?.verified_key_data?.us_stock) {
    const usPct = marketDigest?.verified_key_data?.us_stock?.sp500_change_pct || 'N/A';
    const sign = usPct >= 0 ? '▲' : '▼';
    marketParts.push(`美股 ${sign}${usPct}%`);
  }
  if (marketParts.length > 0) lines.push(`📈 ${marketParts.join(' | ')}`);

  if (marketRegime) lines.push(`🔍 ${marketRegime}`);

  if (finalNews && finalNews.length > 0) {
    lines.push('');
    lines.push('🌐 焦點：');
    finalNews.slice(0, 3).forEach(news => {
      const short = news.length > 40 ? news.substring(0, 40) + '...' : news;
      lines.push(`  • ${short}`);
    });
  }

  if (twoStageSummary && !twoStageSummary.skipped && twoStageSummary.brief30s) {
    lines.push('');
    lines.push('⚡ AI 摘要：');
    twoStageSummary.brief30s.split('\n').slice(0, 3).forEach(l => { if (l.trim()) lines.push(l.trim()); });
  }

  lines.push('');
  lines.push('💬 輸入 /today 查看完整版');
  lines.push('━━━━━━━━━━━━━━━━━━');
  return lines.join('\n');
}

/**
 * Full 報告（原始全文）
 */
function renderFullReport(data) {
  const { allText } = data;
  const now = new Date();
  const dateStr = now.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  });
  const timeStr = now.toLocaleTimeString('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit'
  });
  const lines = [
    '📰 原始早報全文',
    `📅 ${dateStr} ${timeStr}`,
    '━━━━━━━━━━━━━━━━━━',
    '',
    allText || '（無資料）',
    '',
    '━━━━━━━━━━━━━━━━━━',
    '⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議',
    '📡 數據來源：LINE 群組早報（原文）'
  ];
  return lines.join('\n');
}

/**
 * 渲染市場數據區塊（共用）
 */
function renderMarketDataSection(lines, lineMarketData, marketDigest) {
  // 台股
  if (lineMarketData.tw_stock) {
    const tw = lineMarketData.tw_stock;
    const sign = tw.change >= 0 ? '▲' : '▼';
    const vol = tw.volume ? `量 ${tw.volume}億` : '';
    lines.push(`• 加權指數：${tw.index?.toLocaleString() || 'N/A'} ${sign}${Math.abs(tw.change || 0)} ${vol}`);
  } else if (marketDigest?.verified_key_data?.tw_stock) {
    const tw = marketDigest.verified_key_data.tw_stock;
    const sign = tw.taiex_change_pct >= 0 ? '▲' : '▼';
    lines.push(`• 加權指數：${tw.taiex_close?.toLocaleString() || 'N/A'} ${sign}${Math.abs(tw.taiex_change_pct || 0)}%`);
  }

  // 美股
  if (marketDigest?.verified_key_data?.us_stock) {
    const us = marketDigest.verified_key_data.us_stock;
    const spSign = us.sp500_change_pct >= 0 ? '+' : '';
    const nqSign = us.nasdaq_change_pct >= 0 ? '+' : '';
    lines.push(`• S&P 500：${us.sp500_close?.toLocaleString() || 'N/A'} (${spSign}${us.sp500_change_pct}%) | Nasdaq (${nqSign}${us.nasdaq_change_pct}%)`);
  } else if (lineMarketData.us_stock.sp500) {
    lines.push(`• S&P 500：${lineMarketData.us_stock.sp500.toLocaleString()}`);
  }

  // 匯率
  if (marketDigest?.verified_key_data?.fx) {
    const fx = marketDigest.verified_key_data.fx;
    const sign = fx.usdtwd_change_pct >= 0 ? '貶' : '升';
    lines.push(`• USD/TWD：${fx.usdtwd?.toFixed(2) || 'N/A'} (${sign}${Math.abs(fx.usdtwd_change_pct)}%)`);
  } else if (lineMarketData.fx.usdtwd) {
    lines.push(`• USD/TWD：${lineMarketData.fx.usdtwd}`);
  }
}

/**
 * 加上頁尾
 */
function appendFooter(lines) {
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  lines.push('📡 TWSE | Yahoo Finance | FMP | FinMind | Perplexity');
  return lines.join('\n');
}

module.exports = { renderReport, renderUnifiedMorningReport };
