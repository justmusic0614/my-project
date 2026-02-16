#!/usr/bin/env node
// Weekly Reporter - 週報生成器（C 項目）
// 提供週度趨勢分析、個股排名、法人動向統計

const fs = require('fs');
const path = require('path');
const { getChipData } = require('./chip-data-fetcher');
const { getFinancialData } = require('./financial-data-fetcher');
const { comprehensiveAnalysis } = require('./chip-analyzer');

/**
 * 取得過去 N 個交易日的日期列表
 */
function getRecentTradingDays(days = 5) {
  const dates = [];
  const today = new Date();
  
  // 往前推算，跳過週末
  let count = 0;
  let offset = 0;
  
  while (count < days) {
    const date = new Date(today.getTime() - offset * 86400000);
    const dayOfWeek = date.getDay();
    
    // 跳過週末（0=日, 6=六）
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(date.toISOString().split('T')[0]);
      count++;
    }
    
    offset++;
  }
  
  return dates.reverse(); // 由舊到新
}

/**
 * 從快取讀取歷史籌碼數據
 * 注意：需要先執行過 chip-data-fetcher 才有快取
 */
function loadHistoricalChipData(stockCode, dates) {
  const CACHE_DIR = path.join(__dirname, 'data/chip-cache');
  const history = [];
  
  for (const date of dates) {
    const dateKey = date.replace(/-/g, '');
    const cachePath = path.join(CACHE_DIR, `institutional-${dateKey}.json`);
    
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        
        if (data && data.data) {
          const stock = data.data.find(row => row[0] === stockCode);
          
          if (stock) {
            const parseNum = (str) => {
              if (!str || str === '--') return 0;
              return parseInt(str.toString().replace(/,/g, ''));
            };
            
            history.push({
              date: date,
              foreign: parseNum(stock[4]),
              trust: parseNum(stock[10]),
              dealer: parseNum(stock[11]),
              total: parseNum(stock[18])
            });
          }
        }
      } catch (err) {
        console.error(`⚠️  無法讀取 ${date} 的快取：${err.message}`);
      }
    }
  }
  
  return history;
}

/**
 * 計算週度統計
 */
function calculateWeeklyStats(history) {
  if (history.length === 0) {
    return null;
  }
  
  // 累計買賣超
  const totalForeign = history.reduce((sum, day) => sum + day.foreign, 0);
  const totalTrust = history.reduce((sum, day) => sum + day.trust, 0);
  const totalDealer = history.reduce((sum, day) => sum + day.dealer, 0);
  const totalAll = history.reduce((sum, day) => sum + day.total, 0);
  
  // 連續買超/賣超天數
  let consecutiveBuyDays = 0;
  let consecutiveSellDays = 0;
  
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].total > 0) {
      consecutiveBuyDays++;
      consecutiveSellDays = 0;
    } else if (history[i].total < 0) {
      consecutiveSellDays++;
      consecutiveBuyDays = 0;
    } else {
      break;
    }
  }
  
  return {
    days: history.length,
    foreign: {
      total: totalForeign,
      avg: Math.round(totalForeign / history.length)
    },
    trust: {
      total: totalTrust,
      avg: Math.round(totalTrust / history.length)
    },
    dealer: {
      total: totalDealer,
      avg: Math.round(totalDealer / history.length)
    },
    all: {
      total: totalAll,
      avg: Math.round(totalAll / history.length)
    },
    consecutiveBuyDays,
    consecutiveSellDays
  };
}

/**
 * 生成單檔週報
 */
async function generateStockWeeklyReport(stockCode, days = 5) {
  console.log(`\n📊 正在生成 ${stockCode} 的週報（近 ${days} 日）...`);
  console.log('━━━━━━━━━━━━━━━━━━\n');
  
  // 取得最新數據
  const [chipData, financialData] = await Promise.all([
    getChipData(stockCode),
    getFinancialData(stockCode)
  ]);
  
  if (!chipData) {
    console.error(`❌ 無法取得 ${stockCode} 的數據`);
    return null;
  }
  
  // 取得歷史數據
  const dates = getRecentTradingDays(days);
  const history = loadHistoricalChipData(stockCode, dates);
  
  // 計算週度統計
  const weeklyStats = calculateWeeklyStats(history);
  
  // 執行分析
  const analysis = comprehensiveAnalysis(chipData);
  
  return {
    stock: chipData.stock,
    current: {
      chip: chipData,
      financial: financialData,
      analysis: analysis
    },
    weekly: weeklyStats,
    history: history
  };
}

/**
 * 格式化單檔週報
 */
function formatStockWeeklyReport(report) {
  if (!report) {
    return '❌ 無週報資料';
  }
  
  const lines = [];
  
  lines.push(`📊 ${report.stock.code} ${report.stock.name} - 週報`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 最新狀態
  if (report.current.analysis) {
    const a = report.current.analysis;
    lines.push(`🎯 籌碼評分：${a.score}/100 ${a.recommendationIcon}`);
    lines.push(`   ${a.recommendationMessage}`);
    lines.push('');
  }
  
  // 週度法人動向
  if (report.weekly) {
    const w = report.weekly;
    lines.push(`📌 週度法人動向（近 ${w.days} 日）`);
    lines.push(`   • 外資：累計 ${w.foreign.total > 0 ? '買超' : '賣超'} ${(Math.abs(w.foreign.total) / 1000).toFixed(0)} 張（日均 ${(Math.abs(w.foreign.avg) / 1000).toFixed(0)} 張）`);
    lines.push(`   • 投信：累計 ${w.trust.total > 0 ? '買超' : '賣超'} ${(Math.abs(w.trust.total) / 1000).toFixed(0)} 張（日均 ${(Math.abs(w.trust.avg) / 1000).toFixed(0)} 張）`);
    lines.push(`   • 自營商：累計 ${w.dealer.total > 0 ? '買超' : '賣超'} ${(Math.abs(w.dealer.total) / 1000).toFixed(0)} 張`);
    lines.push(`   • 合計：累計 ${w.all.total > 0 ? '買超' : '賣超'} ${(Math.abs(w.all.total) / 1000).toFixed(0)} 張`);
    
    // 連續買超/賣超
    if (w.consecutiveBuyDays > 0) {
      lines.push(`   🟢 連續買超 ${w.consecutiveBuyDays} 日`);
    } else if (w.consecutiveSellDays > 0) {
      lines.push(`   🔴 連續賣超 ${w.consecutiveSellDays} 日`);
    }
    
    lines.push('');
  }
  
  // 最新交易數據
  if (report.current.chip && report.current.chip.dailyTrade) {
    const t = report.current.chip.dailyTrade;
    lines.push(`💹 最新交易`);
    lines.push(`   • 收盤：${t.closingPrice} 元（${t.change > 0 ? '▲' : '▼'} ${Math.abs(t.change)}）`);
    lines.push(`   • 成交量：${(t.tradeVolume / 1000).toFixed(0)} 張`);
    lines.push('');
  }
  
  // 融資融券
  if (report.current.chip && report.current.chip.marginTrading) {
    const m = report.current.chip.marginTrading;
    const marginChange = m.marginBalanceToday - m.marginBalancePrev;
    const marginUsage = m.marginLimit > 0 ? (m.marginBalanceToday / m.marginLimit * 100).toFixed(2) : 0;
    lines.push(`💰 融資券`);
    lines.push(`   • 融資：${m.marginBalanceToday.toLocaleString()} 張（${marginChange >= 0 ? '▲' : '▼'} ${Math.abs(marginChange).toLocaleString()}）使用率 ${marginUsage}%`);
    lines.push('');
  }
  
  // 異常提醒
  if (report.current.analysis && report.current.analysis.alerts.length > 0) {
    lines.push(`⚠️  異常提醒`);
    report.current.analysis.alerts.forEach(alert => {
      lines.push(`   ${alert.icon} ${alert.message}`);
    });
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * 生成 Watchlist 週報
 */
async function generateWatchlistWeeklyReport(days = 5) {
  const WATCHLIST_PATH = path.join(__dirname, 'data/watchlist.json');
  
  if (!fs.existsSync(WATCHLIST_PATH)) {
    console.log('📭 Watchlist 是空的');
    return null;
  }
  
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
  
  if (watchlist.stocks.length === 0) {
    console.log('📭 Watchlist 是空的');
    return null;
  }
  
  console.log(`🔄 正在生成 ${watchlist.stocks.length} 檔股票的週報...\n`);
  
  const reports = [];
  
  for (const stock of watchlist.stocks) {
    const report = await generateStockWeeklyReport(stock.code, days);
    
    if (report) {
      reports.push(report);
    }
    
    // 禮貌間隔
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return {
    date: new Date().toISOString().split('T')[0],
    days: days,
    reports: reports
  };
}

/**
 * 格式化 Watchlist 週報
 */
function formatWatchlistWeeklyReport(weeklyReport) {
  if (!weeklyReport || weeklyReport.reports.length === 0) {
    return '📭 無週報資料';
  }
  
  const lines = [];
  
  lines.push(`📊 Watchlist 週報（${weeklyReport.date}）`);
  lines.push(`📅 統計週期：近 ${weeklyReport.days} 個交易日`);
  lines.push('━━━━━━━━━━━━━━━━━━\n');
  
  // 整體統計
  const stats = {
    avgScore: 0,
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    consecutiveBuyStocks: [],
    consecutiveSellStocks: [],
    strongBuyStocks: [],
    strongSellStocks: []
  };
  
  weeklyReport.reports.forEach(report => {
    if (report.current.analysis) {
      const a = report.current.analysis;
      stats.avgScore += a.score;
      
      if (a.recommendation === 'bullish') {
        stats.bullishCount++;
      } else if (a.recommendation === 'bearish') {
        stats.bearishCount++;
      } else {
        stats.neutralCount++;
      }
    }
    
    if (report.weekly) {
      const w = report.weekly;
      
      // 連續買超/賣超
      if (w.consecutiveBuyDays >= 3) {
        stats.consecutiveBuyStocks.push({
          code: report.stock.code,
          name: report.stock.name,
          days: w.consecutiveBuyDays
        });
      }
      
      if (w.consecutiveSellDays >= 3) {
        stats.consecutiveSellStocks.push({
          code: report.stock.code,
          name: report.stock.name,
          days: w.consecutiveSellDays
        });
      }
      
      // 週度大幅買超/賣超（絕對值 > 10000 張）
      if (Math.abs(w.all.total) > 10000000) {
        if (w.all.total > 0) {
          stats.strongBuyStocks.push({
            code: report.stock.code,
            name: report.stock.name,
            total: w.all.total
          });
        } else {
          stats.strongSellStocks.push({
            code: report.stock.code,
            name: report.stock.name,
            total: w.all.total
          });
        }
      }
    }
  });
  
  stats.avgScore = Math.round(stats.avgScore / weeklyReport.reports.length);
  
  // 顯示整體統計
  lines.push(`📈 整體概況`);
  lines.push(`   • 平均評分：${stats.avgScore}/100`);
  lines.push(`   • 籌碼分布：🟢 ${stats.bullishCount} 檔偏多 | 🔴 ${stats.bearishCount} 檔偏空 | ➖ ${stats.neutralCount} 檔中性`);
  lines.push('');
  
  // 重點提醒
  const hasAlerts = stats.consecutiveBuyStocks.length > 0 || 
                    stats.consecutiveSellStocks.length > 0 ||
                    stats.strongBuyStocks.length > 0 ||
                    stats.strongSellStocks.length > 0;
  
  if (hasAlerts) {
    lines.push(`⚠️  重點提醒`);
    lines.push('');
    
    // 連續買超
    if (stats.consecutiveBuyStocks.length > 0) {
      lines.push(`🟢 連續買超（${stats.consecutiveBuyStocks.length} 檔）`);
      stats.consecutiveBuyStocks.forEach(s => {
        lines.push(`   • ${s.code} ${s.name}：連續 ${s.days} 日`);
      });
      lines.push('');
    }
    
    // 連續賣超
    if (stats.consecutiveSellStocks.length > 0) {
      lines.push(`🔴 連續賣超（${stats.consecutiveSellStocks.length} 檔）`);
      stats.consecutiveSellStocks.forEach(s => {
        lines.push(`   • ${s.code} ${s.name}：連續 ${s.days} 日`);
      });
      lines.push('');
    }
    
    // 週度大幅買超
    if (stats.strongBuyStocks.length > 0) {
      lines.push(`💪 週度大幅買超（${stats.strongBuyStocks.length} 檔）`);
      stats.strongBuyStocks.forEach(s => {
        lines.push(`   • ${s.code} ${s.name}：${(s.total / 1000).toFixed(0)} 張`);
      });
      lines.push('');
    }
    
    // 週度大幅賣超
    if (stats.strongSellStocks.length > 0) {
      lines.push(`📉 週度大幅賣超（${stats.strongSellStocks.length} 檔）`);
      stats.strongSellStocks.forEach(s => {
        lines.push(`   • ${s.code} ${s.name}：${(Math.abs(s.total) / 1000).toFixed(0)} 張`);
      });
      lines.push('');
    }
  }
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('📋 個股週報');
  lines.push('━━━━━━━━━━━━━━━━━━\n');
  
  // 個股詳細報告
  // 依評分排序
  weeklyReport.reports.sort((a, b) => {
    const scoreA = a.current.analysis ? a.current.analysis.score : 50;
    const scoreB = b.current.analysis ? b.current.analysis.score : 50;
    return scoreB - scoreA;
  });
  
  weeklyReport.reports.forEach((report, idx) => {
    lines.push(`${idx + 1}. ${formatStockWeeklyReport(report)}`);
    lines.push('');
  });
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push(`🕒 生成時間：${new Date().toLocaleString('zh-TW')}`);
  
  return lines.join('\n');
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'stock') {
    const stockCode = process.argv[3];
    const days = parseInt(process.argv[4] || '5', 10);
    
    if (!stockCode) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node weekly-reporter.js stock 2330 5');
      process.exit(1);
    }
    
    (async () => {
      const report = await generateStockWeeklyReport(stockCode, days);
      console.log('\n' + formatStockWeeklyReport(report));
    })();
    
  } else if (command === 'watchlist') {
    const days = parseInt(process.argv[3] || '5', 10);
    
    (async () => {
      const weeklyReport = await generateWatchlistWeeklyReport(days);
      const formatted = formatWatchlistWeeklyReport(weeklyReport);
      console.log('\n' + formatted);
    })();
    
  } else {
    console.log(`
Weekly Reporter - 週報生成器

指令：
  stock <代號> [days]        生成單檔週報（預設 5 日）
  watchlist [days]          生成 Watchlist 週報（預設 5 日）

範例：
  node weekly-reporter.js stock 2330 5
  node weekly-reporter.js watchlist 7

功能：
  • 週度法人買賣超累計
  • 連續買超/賣超天數
  • 週度趨勢分析
  • 異常事件摘要

C 項目：週報優化
    `);
  }
}

module.exports = {
  generateStockWeeklyReport,
  generateWatchlistWeeklyReport,
  formatStockWeeklyReport,
  formatWatchlistWeeklyReport,
  getRecentTradingDays,
  loadHistoricalChipData,
  calculateWeeklyStats
};
