#!/usr/bin/env node
// Chip Analyzer - 籌碼面智慧分析（F 項目）
// 提供異常檢測、趨勢分析、風險評估

/**
 * 分析規則與評分標準
 * 
 * 融資使用率：
 * - < 5%：健康 ✅
 * - 5-15%：正常 ⚠️
 * - 15-30%：偏高 🟡
 * - > 30%：危險 🔴
 * 
 * 三大法人：
 * - 外資買超 > 5000 張：🟢 強勢買超
 * - 外資賣超 > 5000 張：🔴 強勢賣超
 * - 投信買超 > 1000 張：🟢 投信加碼
 * - 投信賣超 > 1000 張：🔴 投信減碼
 * 
 * 融資變化：
 * - 單日增加 > 5%：🟡 融資大增
 * - 單日減少 > 5%：🟢 融資減少
 */

/**
 * 分析融資使用率
 */
function analyzeMarginUsage(marginTrading) {
  if (!marginTrading || !marginTrading.marginLimit) {
    return null;
  }
  
  const usage = (marginTrading.marginBalanceToday / marginTrading.marginLimit * 100);
  const change = marginTrading.marginBalanceToday - marginTrading.marginBalancePrev;
  const changePercent = marginTrading.marginBalancePrev > 0 
    ? (change / marginTrading.marginBalancePrev * 100) 
    : 0;
  
  let level = 'healthy';
  let icon = '✅';
  let message = '籌碼健康';
  
  if (usage > 30) {
    level = 'danger';
    icon = '🔴';
    message = '融資使用率過高，投機氣氛濃厚';
  } else if (usage > 15) {
    level = 'warning';
    icon = '🟡';
    message = '融資使用率偏高，注意短線波動';
  } else if (usage > 5) {
    level = 'normal';
    icon = '⚠️';
    message = '融資使用率正常';
  }
  
  const alerts = [];
  
  // 單日融資大幅變化
  if (Math.abs(changePercent) > 5) {
    if (changePercent > 0) {
      alerts.push({
        type: 'margin_surge',
        icon: '🟡',
        message: `融資單日大增 ${changePercent.toFixed(2)}%，投機買盤進場`
      });
    } else {
      alerts.push({
        type: 'margin_drop',
        icon: '🟢',
        message: `融資單日大減 ${Math.abs(changePercent).toFixed(2)}%，籌碼改善`
      });
    }
  }
  
  return {
    level,
    icon,
    message,
    usage: usage.toFixed(2),
    change,
    changePercent: changePercent.toFixed(2),
    alerts
  };
}

/**
 * 分析三大法人買賣超
 */
function analyzeInstitutionalInvestors(institutional) {
  if (!institutional) {
    return null;
  }
  
  const alerts = [];
  
  // 外資分析
  if (institutional.foreign > 5000000) { // > 5000 張（股數）
    alerts.push({
      type: 'foreign_strong_buy',
      icon: '🟢',
      message: `外資強勢買超 ${(institutional.foreign / 1000).toFixed(0)} 張`
    });
  } else if (institutional.foreign < -5000000) {
    alerts.push({
      type: 'foreign_strong_sell',
      icon: '🔴',
      message: `外資強勢賣超 ${Math.abs(institutional.foreign / 1000).toFixed(0)} 張`
    });
  }
  
  // 投信分析
  if (institutional.trust > 1000000) { // > 1000 張
    alerts.push({
      type: 'trust_buy',
      icon: '🟢',
      message: `投信加碼 ${(institutional.trust / 1000).toFixed(0)} 張`
    });
  } else if (institutional.trust < -1000000) {
    alerts.push({
      type: 'trust_sell',
      icon: '🔴',
      message: `投信減碼 ${Math.abs(institutional.trust / 1000).toFixed(0)} 張`
    });
  }
  
  // 三大法人合計分析
  let sentiment = 'neutral';
  let sentimentIcon = '➖';
  let sentimentMessage = '法人觀望';
  
  if (institutional.total > 3000000) { // > 3000 張
    sentiment = 'bullish';
    sentimentIcon = '🟢';
    sentimentMessage = '法人看多';
  } else if (institutional.total < -3000000) {
    sentiment = 'bearish';
    sentimentIcon = '🔴';
    sentimentMessage = '法人看空';
  }
  
  return {
    sentiment,
    sentimentIcon,
    sentimentMessage,
    alerts
  };
}

/**
 * 分析融券變化
 */
function analyzeShortInterest(marginTrading) {
  if (!marginTrading) {
    return null;
  }
  
  const change = marginTrading.shortBalanceToday - marginTrading.shortBalancePrev;
  const changePercent = marginTrading.shortBalancePrev > 0 
    ? (change / marginTrading.shortBalancePrev * 100) 
    : 0;
  
  const alerts = [];
  
  // 融券大幅減少（回補）
  if (changePercent < -10 && marginTrading.shortBalancePrev > 1000) {
    alerts.push({
      type: 'short_cover',
      icon: '🟢',
      message: `融券大幅回補 ${Math.abs(changePercent).toFixed(2)}%，空頭回補推升股價`
    });
  }
  
  // 融券大幅增加
  if (changePercent > 10 && change > 500) {
    alerts.push({
      type: 'short_surge',
      icon: '🟡',
      message: `融券大增 ${changePercent.toFixed(2)}%，空方進場`
    });
  }
  
  return {
    change,
    changePercent: changePercent.toFixed(2),
    alerts
  };
}

/**
 * 綜合分析（整合所有指標）
 */
function comprehensiveAnalysis(chipData) {
  if (!chipData) {
    return null;
  }
  
  const analysis = {
    stock: chipData.stock,
    timestamp: new Date().toISOString(),
    alerts: [],
    score: 50, // 基準分數 50（中性）
    recommendation: 'neutral'
  };
  
  // 融資分析
  if (chipData.marginTrading) {
    const marginAnalysis = analyzeMarginUsage(chipData.marginTrading);
    if (marginAnalysis) {
      analysis.marginAnalysis = marginAnalysis;
      analysis.alerts.push(...marginAnalysis.alerts);
      
      // 評分調整
      if (marginAnalysis.level === 'danger') {
        analysis.score -= 20;
      } else if (marginAnalysis.level === 'warning') {
        analysis.score -= 10;
      } else if (marginAnalysis.level === 'healthy') {
        analysis.score += 10;
      }
    }
  }
  
  // 三大法人分析
  if (chipData.institutionalInvestors) {
    const institutionalAnalysis = analyzeInstitutionalInvestors(chipData.institutionalInvestors);
    if (institutionalAnalysis) {
      analysis.institutionalAnalysis = institutionalAnalysis;
      analysis.alerts.push(...institutionalAnalysis.alerts);
      
      // 評分調整
      if (institutionalAnalysis.sentiment === 'bullish') {
        analysis.score += 15;
      } else if (institutionalAnalysis.sentiment === 'bearish') {
        analysis.score -= 15;
      }
    }
  }
  
  // 融券分析
  if (chipData.marginTrading) {
    const shortAnalysis = analyzeShortInterest(chipData.marginTrading);
    if (shortAnalysis) {
      analysis.shortAnalysis = shortAnalysis;
      analysis.alerts.push(...shortAnalysis.alerts);
    }
  }
  
  // 綜合建議
  if (analysis.score >= 65) {
    analysis.recommendation = 'bullish';
    analysis.recommendationIcon = '🟢';
    analysis.recommendationMessage = '籌碼面偏多，建議關注';
  } else if (analysis.score <= 35) {
    analysis.recommendation = 'bearish';
    analysis.recommendationIcon = '🔴';
    analysis.recommendationMessage = '籌碼面偏空，建議觀望';
  } else {
    analysis.recommendation = 'neutral';
    analysis.recommendationIcon = '➖';
    analysis.recommendationMessage = '籌碼面中性，持續追蹤';
  }
  
  return analysis;
}

/**
 * 格式化分析報告
 */
function formatAnalysis(analysis) {
  if (!analysis) {
    return '❌ 無分析資料';
  }
  
  const lines = [];
  
  lines.push(`📊 ${analysis.stock.code} ${analysis.stock.name} - 籌碼分析`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 綜合評分
  lines.push(`🎯 綜合評分：${analysis.score}/100`);
  lines.push(`${analysis.recommendationIcon} ${analysis.recommendationMessage}`);
  lines.push('');
  
  // 異常提醒
  if (analysis.alerts.length > 0) {
    lines.push(`⚠️  異常提醒（${analysis.alerts.length} 項）`);
    analysis.alerts.forEach(alert => {
      lines.push(`   ${alert.icon} ${alert.message}`);
    });
    lines.push('');
  }
  
  // 融資分析
  if (analysis.marginAnalysis) {
    const m = analysis.marginAnalysis;
    lines.push(`💰 融資分析`);
    lines.push(`   ${m.icon} ${m.message}`);
    lines.push(`   • 使用率：${m.usage}%`);
    lines.push(`   • 單日變化：${m.changePercent}%`);
    lines.push('');
  }
  
  // 法人分析
  if (analysis.institutionalAnalysis) {
    const ii = analysis.institutionalAnalysis;
    lines.push(`📌 法人分析`);
    lines.push(`   ${ii.sentimentIcon} ${ii.sentimentMessage}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * 批次分析（用於 watchlist）
 */
async function batchAnalysis(chipDataList) {
  const results = [];
  
  for (const chipData of chipDataList) {
    const analysis = comprehensiveAnalysis(chipData);
    if (analysis) {
      results.push(analysis);
    }
  }
  
  // 依評分排序（高到低）
  results.sort((a, b) => b.score - a.score);
  
  return results;
}

/**
 * 格式化批次分析報告（精簡版）
 */
function formatBatchAnalysis(analysisList) {
  if (!analysisList || analysisList.length === 0) {
    return '';
  }
  
  const lines = [];
  
  lines.push('📊 籌碼面智慧分析');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 統計
  const bullishCount = analysisList.filter(a => a.recommendation === 'bullish').length;
  const bearishCount = analysisList.filter(a => a.recommendation === 'bearish').length;
  const neutralCount = analysisList.filter(a => a.recommendation === 'neutral').length;
  
  lines.push(`📈 籌碼概況：🟢 ${bullishCount} 檔偏多 | 🔴 ${bearishCount} 檔偏空 | ➖ ${neutralCount} 檔中性`);
  lines.push('');
  
  // 重點提醒（有異常的股票）
  const withAlerts = analysisList.filter(a => a.alerts.length > 0);
  if (withAlerts.length > 0) {
    lines.push(`⚠️  重點提醒（${withAlerts.length} 檔）`);
    withAlerts.forEach(a => {
      lines.push(`\n${a.stock.code} ${a.stock.name}（評分 ${a.score}）`);
      a.alerts.forEach(alert => {
        lines.push(`   ${alert.icon} ${alert.message}`);
      });
    });
    lines.push('');
  }
  
  return lines.join('\n');
}

// CLI 測試模式（已廢棄）
if (require.main === module) {
  console.error('⚠️  此腳本已廢棄，請使用統一入口：');
  console.error('    node index.js cmd <子命令>');
  console.error('    node index.js today');
  console.error('📖 完整說明：node index.js（無參數）');
  process.exit(1);

  // 以下為原始 CLI 程式碼（已停用）
  const { getChipData } = require('./chip-data-fetcher');

  const command = process.argv[2];
  
  if (command === 'analyze') {
    const stockCode = process.argv[3];
    
    if (!stockCode) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node chip-analyzer.js analyze 2330');
      process.exit(1);
    }
    
    (async () => {
      const chipData = await getChipData(stockCode);
      const analysis = comprehensiveAnalysis(chipData);
      console.log('\n' + formatAnalysis(analysis));
    })();
    
  } else {
    console.log(`
Chip Analyzer - 籌碼面智慧分析

指令：
  analyze <股票代號>         分析單檔股票籌碼面

範例：
  node chip-analyzer.js analyze 2330

分析項目：
  • 融資使用率與變化
  • 三大法人買賣超
  • 融券回補/增加
  • 綜合評分（0-100）
  • 智慧建議

F 項目：分析能力提升
    `);
  }
}

module.exports = {
  analyzeMarginUsage,
  analyzeInstitutionalInvestors,
  analyzeShortInterest,
  comprehensiveAnalysis,
  formatAnalysis,
  batchAnalysis,
  formatBatchAnalysis
};
