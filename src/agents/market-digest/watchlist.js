#!/usr/bin/env node
// Watchlist - 個股追蹤清單
// 使用：node watchlist.js add 2330 2454 2408
//      node watchlist.js summary
//      node watchlist.js history 2454 --days 7

const fs = require('fs');
const path = require('path');
const { getFinancialData } = require('./financial-data-fetcher');
const { getChipData } = require('./chip-data-fetcher');
const { comprehensiveAnalysis, formatBatchAnalysis } = require('./chip-analyzer');
const { generateWatchlistWeeklyReport, formatWatchlistWeeklyReport } = require('./weekly-reporter');

const WATCHLIST_PATH = path.join(__dirname, 'data/watchlist.json');

/**
 * 股票資料庫（台股常見個股）
 */
const STOCK_DB = {
  '2330': '台積電',
  '2454': '聯發科',
  '2317': '鴻海',
  '2408': '南亞科',
  '2412': '中華電',
  '2882': '國泰金',
  '2303': '聯電',
  '2308': '台達電',
  '2382': '廣達',
  '2603': '長榮',
  '3037': '欣興',
  '3008': '大立光',
  '2311': '日月光',
  '4958': '臻鼎-KY',
  '1590': '亞德客-KY',
  '2233': '宇隆',
  '6683': '雍智科技',
  '5274': '信驊',
  '3231': '緯創',
  '2357': '華碩',
};

/**
 * 讀取 watchlist
 */
function loadWatchlist() {
  if (!fs.existsSync(WATCHLIST_PATH)) {
    return { stocks: [], createdAt: new Date().toISOString() };
  }
  
  return JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
}

/**
 * 儲存 watchlist
 */
function saveWatchlist(watchlist) {
  const dir = path.dirname(WATCHLIST_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  watchlist.updatedAt = new Date().toISOString();
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
}

/**
 * 新增股票到 watchlist
 */
function addStocks(codes) {
  const watchlist = loadWatchlist();
  let added = 0;
  
  codes.forEach(code => {
    // 標準化代號（移除空格、括號等）
    const cleanCode = code.replace(/[^\d]/g, '');
    
    // 檢查是否已存在
    const exists = watchlist.stocks.find(s => s.code === cleanCode);
    if (exists) {
      console.log(`⚠️  ${cleanCode} 已在列表中`);
      return;
    }
    
    // 查找名稱
    const name = STOCK_DB[cleanCode] || '未知';
    
    watchlist.stocks.push({
      code: cleanCode,
      name: name,
      addedAt: new Date().toISOString()
    });
    
    console.log(`✅ 已新增：${cleanCode} ${name}`);
    added++;
  });
  
  if (added > 0) {
    saveWatchlist(watchlist);
    console.log(`\n📊 目前追蹤 ${watchlist.stocks.length} 檔個股`);
  }
}

/**
 * 移除股票
 */
function removeStocks(codes) {
  const watchlist = loadWatchlist();
  let removed = 0;
  
  codes.forEach(code => {
    const cleanCode = code.replace(/[^\d]/g, '');
    const index = watchlist.stocks.findIndex(s => s.code === cleanCode);
    
    if (index === -1) {
      console.log(`⚠️  ${cleanCode} 不在列表中`);
      return;
    }
    
    const stock = watchlist.stocks[index];
    watchlist.stocks.splice(index, 1);
    console.log(`✅ 已移除：${stock.code} ${stock.name}`);
    removed++;
  });
  
  if (removed > 0) {
    saveWatchlist(watchlist);
    console.log(`\n📊 目前追蹤 ${watchlist.stocks.length} 檔個股`);
  }
}

/**
 * 列出 watchlist
 */
function listWatchlist() {
  const watchlist = loadWatchlist();
  
  if (watchlist.stocks.length === 0) {
    console.log('📭 Watchlist 是空的');
    console.log('💡 使用 node watchlist.js add 2330 2454 2408 新增個股');
    return;
  }
  
  console.log(`📊 我的追蹤清單（${watchlist.stocks.length} 檔）`);
  console.log('━━━━━━━━━━━━━━━━━━');
  
  watchlist.stocks.forEach((stock, i) => {
    const addedDate = new Date(stock.addedAt).toLocaleDateString('zh-TW', {
      month: '2-digit',
      day: '2-digit'
    });
    console.log(`${i + 1}. ${stock.code} ${stock.name} (加入於 ${addedDate})`);
  });
  
  console.log('');
  console.log(`📅 最後更新：${new Date(watchlist.updatedAt || watchlist.createdAt).toLocaleString('zh-TW')}`);
}

/**
 * 清空 watchlist
 */
function clearWatchlist() {
  const watchlist = loadWatchlist();
  const count = watchlist.stocks.length;
  
  watchlist.stocks = [];
  saveWatchlist(watchlist);
  
  console.log(`✅ 已清空 watchlist（移除 ${count} 檔個股）`);
}

/**
 * 生成今日摘要（從 morning-collect 搜尋）
 */
function generateSummary(date = null) {
  const watchlist = loadWatchlist();
  
  if (watchlist.stocks.length === 0) {
    console.log('📭 Watchlist 是空的，無法生成摘要');
    return null;
  }
  
  const targetDate = date || new Date().toISOString().split('T')[0];
  const collectPath = path.join(__dirname, 'data/morning-collect', `${targetDate}.json`);
  
  if (!fs.existsSync(collectPath)) {
    console.log(`⚠️  找不到 ${targetDate} 的早報資料`);
    return null;
  }
  
  const data = JSON.parse(fs.readFileSync(collectPath, 'utf8'));
  const allText = data.messages.map(m => m.content).join('\n\n');
  
  const summary = {
    date: targetDate,
    stocks: []
  };
  
  watchlist.stocks.forEach(stock => {
    // 搜尋股票名稱或代號
    const pattern = new RegExp(`(${stock.name}|${stock.code}|\\(${stock.code}\\))`, 'gi');
    const matches = [];
    
    let match;
    while ((match = pattern.exec(allText)) !== null) {
      // 提取上下文（前後各 100 字）
      const start = Math.max(0, match.index - 100);
      const end = Math.min(allText.length, match.index + match[0].length + 100);
      const context = allText.substring(start, end).trim();
      
      matches.push({
        match: match[0],
        context: context
      });
    }
    
    if (matches.length > 0) {
      summary.stocks.push({
        code: stock.code,
        name: stock.name,
        mentions: matches.length,
        contexts: matches.slice(0, 3) // 只保留前 3 個
      });
    }
  });
  
  return summary;
}

/**
 * 格式化摘要輸出
 */
function formatSummary(summary) {
  if (!summary || summary.stocks.length === 0) {
    return '📭 今日早報未提及您追蹤的個股';
  }
  
  const lines = [];
  lines.push(`📌 我的關注股（${summary.date}）`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  summary.stocks.forEach(stock => {
    const emoji = stock.mentions > 2 ? '🔥' : stock.mentions > 1 ? '⭐' : '📊';
    lines.push(`${emoji} ${stock.code} ${stock.name} (${stock.mentions} 次提及)`);
    lines.push('');
    
    stock.contexts.forEach((ctx, i) => {
      // 縮短上下文到 150 字
      let text = ctx.context;
      if (text.length > 150) {
        text = text.substring(0, 150) + '...';
      }
      
      lines.push(`  ${i + 1}. ${text}`);
      lines.push('');
    });
  });
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  
  return lines.join('\n');
}

/**
 * 生成帶財報數據的摘要（E2+E3 整合）
 */
async function generateSummaryWithFinancial(date = null) {
  const watchlist = loadWatchlist();
  
  if (watchlist.stocks.length === 0) {
    console.log('📭 Watchlist 是空的，無法生成摘要');
    return null;
  }
  
  console.log(`🔄 正在抓取 ${watchlist.stocks.length} 檔股票的財報與籌碼面數據...\n`);
  
  const summary = {
    date: date || new Date().toISOString().split('T')[0],
    stocks: []
  };
  
  // 抓取財報數據 + 籌碼面數據
  for (const stock of watchlist.stocks) {
    console.log(`⏳ 處理 ${stock.code} ${stock.name}...`);
    
    const [financialData, chipData] = await Promise.all([
      getFinancialData(stock.code),
      getChipData(stock.code)
    ]);
    
    if (financialData || chipData) {
      // 執行籌碼面智慧分析
      const analysis = chipData ? comprehensiveAnalysis(chipData) : null;
      
      summary.stocks.push({
        code: stock.code,
        name: stock.name,
        financial: financialData,
        chip: chipData,
        analysis: analysis
      });
    }
    
    // 禮貌間隔
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // 依分析評分排序（高到低）
  summary.stocks.sort((a, b) => {
    const scoreA = a.analysis ? a.analysis.score : 50;
    const scoreB = b.analysis ? b.analysis.score : 50;
    return scoreB - scoreA;
  });
  
  return summary;
}

/**
 * 格式化帶財報的摘要輸出（E2+E3 整合）
 */
function formatSummaryWithFinancial(summary) {
  if (!summary || summary.stocks.length === 0) {
    return '📭 無法取得財報資料';
  }
  
  const lines = [];
  lines.push(`📊 我的追蹤清單完整報告（${summary.date}）`);
  lines.push('━━━━━━━━━━━━━━━━━━\n');
  
  // 智慧分析摘要
  const analysisList = summary.stocks.map(s => s.analysis).filter(a => a);
  if (analysisList.length > 0) {
    const batchAnalysis = formatBatchAnalysis(analysisList);
    lines.push(batchAnalysis);
  }
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('📋 個股詳細報告');
  lines.push('━━━━━━━━━━━━━━━━━━\n');
  
  summary.stocks.forEach((stock, idx) => {
    const f = stock.financial;
    const c = stock.chip;
    const a = stock.analysis;
    
    // 標題（含評分）
    const score = a ? ` [${a.recommendationIcon} ${a.score}分]` : '';
    lines.push(`${idx + 1}. ${f ? f.stock.code : c.stock.code} ${f ? f.stock.name : c.stock.name}${score}`);
    if (f) {
      lines.push(`   🏢 產業：${f.stock.industry}`);
    }
    
    // 籌碼面：每日交易資料（優先顯示）
    if (c && c.dailyTrade) {
      const t = c.dailyTrade;
      const dateStr = `${t.date.substring(3, 5)}/${t.date.substring(5, 7)}`;
      lines.push(`   💹 交易（${dateStr}）`);
      lines.push(`      • 收盤：${t.closingPrice} 元（${t.change > 0 ? '▲' : '▼'} ${Math.abs(t.change)}）`);
      lines.push(`      • 成交量：${(t.tradeVolume / 1000).toFixed(0)} 張 | 成交值：${(t.tradeValue / 100000000).toFixed(2)} 億`);
    }
    
    // 融資融券
    if (c && c.marginTrading) {
      const m = c.marginTrading;
      const marginChange = m.marginBalanceToday - m.marginBalancePrev;
      const marginUsage = m.marginLimit > 0 ? (m.marginBalanceToday / m.marginLimit * 100).toFixed(2) : 0;
      lines.push(`   💰 融資券`);
      lines.push(`      • 融資：${m.marginBalanceToday.toLocaleString()} 張（${marginChange >= 0 ? '▲' : '▼'} ${Math.abs(marginChange).toLocaleString()}）使用率 ${marginUsage}%`);
      const shortChange = m.shortBalanceToday - m.shortBalancePrev;
      lines.push(`      • 融券：${m.shortBalanceToday.toLocaleString()} 張（${shortChange >= 0 ? '▲' : '▼'} ${Math.abs(shortChange).toLocaleString()}）`);
    }
    
    // 三大法人
    if (c && c.institutionalInvestors) {
      const ii = c.institutionalInvestors;
      const formatShares = (num) => {
        const absNum = Math.abs(num);
        const sign = num >= 0 ? '買超' : '賣超';
        return `${sign} ${(absNum / 1000).toFixed(0)} 張`;
      };
      lines.push(`   📌 三大法人`);
      lines.push(`      • 外資：${formatShares(ii.foreign)} | 投信：${formatShares(ii.trust)} | 自營商：${formatShares(ii.dealer)}`);
    }
    
    // 分析提醒（異常項目）
    if (a && a.alerts && a.alerts.length > 0) {
      lines.push(`   ⚠️  提醒`);
      a.alerts.forEach(alert => {
        lines.push(`      ${alert.icon} ${alert.message}`);
      });
    }
    
    // 財報：營收資料
    if (f && f.revenue) {
      const r = f.revenue;
      lines.push(`   💰 營收（民國${r.year}年${r.month}月）`);
      lines.push(`      • 當月：${(r.revenue / 1000000).toFixed(2)} 億（月增 ${r.revenueMoM > 0 ? '+' : ''}${r.revenueMoM.toFixed(2)}% | 年增 ${r.revenueYoY > 0 ? '+' : ''}${r.revenueYoY.toFixed(2)}%）`);
      lines.push(`      • 累計：${(r.累計營收 / 1000000).toFixed(2)} 億（YoY ${r.累計營收YoY > 0 ? '+' : ''}${r.累計營收YoY.toFixed(2)}%）`);
    }
    
    // 季度財報
    if (f && f.quarterly) {
      const q = f.quarterly;
      lines.push(`   📊 財報（民國${q.year}年Q${q.quarter}）`);
      lines.push(`      • EPS：${q.eps} 元 | 淨利率：${q.profitMargin}%`);
    }
    
    lines.push('');
  });
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push(`🕒 更新時間：${new Date().toLocaleString('zh-TW')}`);
  
  return lines.join('\n');
}

/**
 * 查詢個股歷史（最近 N 天的提及）
 */
function getStockHistory(code, days = 7) {
  const cleanCode = code.replace(/[^\d]/g, '');
  const name = STOCK_DB[cleanCode] || '未知';
  
  const history = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today - i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const collectPath = path.join(__dirname, 'data/morning-collect', `${dateStr}.json`);
    
    if (!fs.existsSync(collectPath)) {
      continue;
    }
    
    const data = JSON.parse(fs.readFileSync(collectPath, 'utf8'));
    const allText = data.messages.map(m => m.content).join('\n\n');
    
    const pattern = new RegExp(`(${name}|${cleanCode}|\\(${cleanCode}\\))`, 'gi');
    const matches = [];
    
    let match;
    while ((match = pattern.exec(allText)) !== null) {
      const start = Math.max(0, match.index - 80);
      const end = Math.min(allText.length, match.index + match[0].length + 80);
      const context = allText.substring(start, end).trim();
      matches.push(context);
    }
    
    if (matches.length > 0) {
      history.push({
        date: dateStr,
        mentions: matches.length,
        contexts: matches.slice(0, 2) // 每天最多 2 個
      });
    }
  }
  
  return {
    code: cleanCode,
    name: name,
    days: days,
    history: history
  };
}

/**
 * 格式化歷史輸出
 */
function formatHistory(historyData) {
  const lines = [];
  lines.push(`📊 ${historyData.code} ${historyData.name}（最近 ${historyData.days} 天）`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  if (historyData.history.length === 0) {
    lines.push(`⚠️  最近 ${historyData.days} 天未提及`);
    return lines.join('\n');
  }
  
  lines.push(`✅ 總計提及 ${historyData.history.length} 天`);
  lines.push('');
  
  historyData.history.forEach(h => {
    lines.push(`📅 ${h.date}（${h.mentions} 次）`);
    h.contexts.forEach((ctx, i) => {
      let text = ctx;
      if (text.length > 120) {
        text = text.substring(0, 120) + '...';
      }
      lines.push(`  ${i + 1}. ${text}`);
    });
    lines.push('');
  });
  
  return lines.join('\n');
}

// CLI 模式（已廢棄）
if (require.main === module) {
  console.error('⚠️  此腳本已廢棄，請使用統一入口：');
  console.error('    node index.js cmd <子命令>');
  console.error('    node index.js today');
  console.error('📖 完整說明：node index.js（無參數）');
  process.exit(1);

  // 以下為原始 CLI 程式碼（已停用）
  const command = process.argv[2];

  if (command === 'add') {
    const codes = process.argv.slice(3);
    if (codes.length === 0) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node watchlist.js add 2330 2454 2408');
      process.exit(1);
    }
    addStocks(codes);
    
  } else if (command === 'remove') {
    const codes = process.argv.slice(3);
    if (codes.length === 0) {
      console.error('❌ 請指定股票代號');
      process.exit(1);
    }
    removeStocks(codes);
    
  } else if (command === 'list') {
    listWatchlist();
    
  } else if (command === 'clear') {
    clearWatchlist();
    
  } else if (command === 'summary') {
    const dateIndex = process.argv.indexOf('--date');
    const date = dateIndex !== -1 ? process.argv[dateIndex + 1] : null;
    
    const summary = generateSummary(date);
    const formatted = formatSummary(summary);
    console.log(formatted);
    
  } else if (command === 'financial') {
    const dateIndex = process.argv.indexOf('--date');
    const date = dateIndex !== -1 ? process.argv[dateIndex + 1] : null;
    
    (async () => {
      const summary = await generateSummaryWithFinancial(date);
      const formatted = formatSummaryWithFinancial(summary);
      console.log('\n' + formatted);
    })();
    
  } else if (command === 'history') {
    const code = process.argv[3];
    if (!code) {
      console.error('❌ 請指定股票代號');
      console.error('💡 使用：node watchlist.js history 2454 --days 7');
      process.exit(1);
    }
    
    const daysIndex = process.argv.indexOf('--days');
    const days = daysIndex !== -1 ? parseInt(process.argv[daysIndex + 1], 10) : 7;
    
    const history = getStockHistory(code, days);
    const formatted = formatHistory(history);
    console.log(formatted);
    
  } else if (command === 'weekly') {
    const daysIndex = process.argv.indexOf('--days');
    const days = daysIndex !== -1 ? parseInt(process.argv[daysIndex + 1], 10) : 5;
    
    (async () => {
      const weeklyReport = await generateWatchlistWeeklyReport(days);
      const formatted = formatWatchlistWeeklyReport(weeklyReport);
      console.log('\n' + formatted);
    })();
    
  } else {
    console.log(`
Watchlist - 個股追蹤清單

指令：
  add <代號...>               新增股票到追蹤清單
  remove <代號...>            移除股票
  list                        列出所有追蹤的股票
  clear                       清空追蹤清單
  summary [--date YYYY-MM-DD] 生成今日摘要（從早報搜尋）
  financial [--date YYYY-MM-DD] 生成財報摘要（E2+E3+F）
  weekly [--days N]           生成週報（預設 5 日，C 項目）
  history <代號> [--days N]   查詢個股歷史（預設 7 天）

範例：
  node watchlist.js add 2330 2454 2408
  node watchlist.js list
  node watchlist.js summary
  node watchlist.js financial
  node watchlist.js weekly --days 7
  node watchlist.js history 2454 --days 14
  node watchlist.js remove 2330
  node watchlist.js clear
    `);
  }
}

module.exports = {
  loadWatchlist,
  addStocks,
  removeStocks,
  generateSummary,
  formatSummary,
  generateSummaryWithFinancial,
  formatSummaryWithFinancial,
  getStockHistory,
  formatHistory
};
