#!/usr/bin/env node
// Weekly Summary - 週報自動匯總
// 使用：node weekly-summary.js generate [--week 2026-W05]
//      node weekly-summary.js push
// Cron: 0 12 * * 5 (每週五 20:00 台北時間)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 取得週的起始和結束日期
 */
function getWeekDates(weekStr = null) {
  let year, week;
  
  if (weekStr) {
    // 解析 "2026-W05" 格式
    const match = weekStr.match(/(\d{4})-W(\d{2})/);
    if (!match) {
      throw new Error(`無效的週格式：${weekStr}，應為 YYYY-WNN（如 2026-W05）`);
    }
    year = parseInt(match[1], 10);
    week = parseInt(match[2], 10);
  } else {
    // 計算本週
    const now = new Date();
    year = now.getFullYear();
    week = getWeekNumber(now);
  }
  
  // 計算週一和週日的日期
  const startDate = getDateOfISOWeek(week, year);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  
  return {
    year,
    week,
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0]
  };
}

/**
 * 取得日期的 ISO 週數
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * 根據 ISO 週數取得週一的日期
 */
function getDateOfISOWeek(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4)
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  else
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  return ISOweekStart;
}

/**
 * 讀取週內的所有早報
 */
function loadWeekReports(startDate, endDate) {
  const reports = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const collectPath = path.join(__dirname, 'data/morning-collect', `${dateStr}.json`);
    
    if (fs.existsSync(collectPath)) {
      const data = JSON.parse(fs.readFileSync(collectPath, 'utf8'));
      reports.push({
        date: dateStr,
        messages: data.messages,
        text: data.messages.map(m => m.content).join('\n\n')
      });
    }
  }
  
  return reports;
}

/**
 * 提取本週重大事件（高頻關鍵字 + 優先級）
 */
function extractWeeklyEvents(reports) {
  const allText = reports.map(r => r.text).join('\n\n');
  const events = [];
  
  // 定義重要關鍵字及其優先級
  const keywordPatterns = [
    // 高優先級：央行、經濟數據
    { pattern: /(?:Fed|聯準會|央行)[^。\n]{20,150}/g, priority: 'high', category: '貨幣政策' },
    { pattern: /(?:降息|升息|利率決策)[^。\n]{20,150}/g, priority: 'high', category: '貨幣政策' },
    { pattern: /(?:非農|就業數據|失業率)[^。\n]{20,150}/g, priority: 'high', category: '經濟數據' },
    { pattern: /(?:GDP|CPI|PPI|通膨)[^。\n]{20,150}/g, priority: 'high', category: '經濟數據' },
    
    // 中優先級：企業、市場動態
    { pattern: /(?:財報|法說會|earnings)[^。\n]{20,150}/g, priority: 'medium', category: '企業動態' },
    { pattern: /(?:併購|收購|M&A)[^。\n]{20,150}/g, priority: 'medium', category: '企業動態' },
    { pattern: /(?:台積電|聯發科|輝達|Meta|微軟)[^。\n]{20,150}/g, priority: 'medium', category: '科技股' },
    
    // 低優先級：一般新聞
    { pattern: /(?:股市|指數)[^。\n]{20,150}/g, priority: 'low', category: '市場動態' },
  ];
  
  keywordPatterns.forEach(({ pattern, priority, category }) => {
    let match;
    while ((match = pattern.exec(allText)) !== null) {
      const text = match[0].trim();
      
      // 去重（相似度檢查）
      const isDuplicate = events.some(e => {
        const overlap = text.split(/\s+/).filter(w => e.text.includes(w) && w.length > 3).length;
        return overlap > 5;
      });
      
      if (!isDuplicate) {
        events.push({
          text,
          priority,
          category
        });
      }
    }
  });
  
  // 按優先級排序
  events.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
  
  return events.slice(0, 15); // 取前 15 條
}

/**
 * 提取本週漲幅前 5 名（從文字中解析）
 */
function extractTopPerformers(reports) {
  const allText = reports.map(r => r.text).join('\n\n');
  const performers = [];
  
  // 模式：「xxx 漲 N%」、「xxx 大漲 N%」
  const pattern = /([^\s]{2,10})(?:股價|）)?(?:大)?漲(?:約)?(?:幅)?(?:達)?[:：]?\s*([0-9.]+)\s*%/g;
  let match;
  
  while ((match = pattern.exec(allText)) !== null) {
    const name = match[1].trim();
    const pct = parseFloat(match[2]);
    
    // 過濾無效名稱
    if (name.length < 2 || name.length > 8 || isNaN(pct)) {
      continue;
    }
    
    performers.push({
      name,
      pct
    });
  }
  
  // 按漲幅排序
  performers.sort((a, b) => b.pct - a.pct);
  
  // 去重（同名取最高漲幅）
  const unique = [];
  const seen = new Set();
  
  performers.forEach(p => {
    if (!seen.has(p.name)) {
      unique.push(p);
      seen.add(p.name);
    }
  });
  
  return unique.slice(0, 5);
}

/**
 * 提取我的關注股本週表現
 */
function getWatchlistPerformance(reports) {
  try {
    const { loadWatchlist } = require('./watchlist');
    const watchlist = loadWatchlist();
    
    if (!watchlist.stocks || watchlist.stocks.length === 0) {
      return [];
    }
    
    const allText = reports.map(r => r.text).join('\n\n');
    const performance = [];
    
    watchlist.stocks.forEach(stock => {
      // 搜尋漲跌幅
      const patterns = [
        new RegExp(`${stock.name}[^。\n]*?(?:漲|跌)(?:幅)?[:：]?\\s*([+-]?[0-9.]+)\\s*%`, 'g'),
        new RegExp(`${stock.code}[^。\n]*?(?:漲|跌)(?:幅)?[:：]?\\s*([+-]?[0-9.]+)\\s*%`, 'g'),
      ];
      
      let bestPct = null;
      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(allText)) !== null) {
          const pct = parseFloat(match[1]);
          if (!isNaN(pct) && (bestPct === null || Math.abs(pct) > Math.abs(bestPct))) {
            bestPct = pct;
          }
        }
      });
      
      if (bestPct !== null) {
        performance.push({
          code: stock.code,
          name: stock.name,
          pct: bestPct
        });
      }
    });
    
    // 按漲幅排序
    performance.sort((a, b) => b.pct - a.pct);
    
    return performance;
    
  } catch (err) {
    console.error('⚠️  Watchlist 載入失敗:', err.message);
    return [];
  }
}

/**
 * 生成週報
 */
function generateWeeklySummary(weekStr = null) {
  console.log('🔄 生成週報中...');
  
  const { year, week, start, end } = getWeekDates(weekStr);
  console.log(`📅 週期：${year} 第 ${week} 週（${start} ~ ${end}）`);
  
  const reports = loadWeekReports(start, end);
  
  if (reports.length === 0) {
    console.error('❌ 本週沒有早報資料');
    return null;
  }
  
  console.log(`📰 載入 ${reports.length} 天的早報`);
  
  // 提取重大事件
  const events = extractWeeklyEvents(reports);
  console.log(`🔍 提取 ${events.length} 則重大事件`);
  
  // 提取漲幅前 5 名
  const topPerformers = extractTopPerformers(reports);
  console.log(`📈 找到 ${topPerformers.length} 個高表現個股`);
  
  // 我的關注股表現
  const watchlistPerf = getWatchlistPerformance(reports);
  console.log(`📌 關注股本週表現：${watchlistPerf.length} 檔`);
  
  // 生成報告
  const summary = formatWeeklySummary({
    year,
    week,
    start,
    end,
    reportCount: reports.length,
    events,
    topPerformers,
    watchlistPerf
  });
  
  // 儲存報告
  const outputPath = path.join(__dirname, 'data/runtime/weekly-summary.txt');
  fs.writeFileSync(outputPath, summary);
  console.log(`✅ 週報已儲存：${outputPath}`);
  console.log(`📏 長度：${summary.length} 字元`);
  
  return summary;
}

/**
 * 格式化週報
 */
function formatWeeklySummary(data) {
  const { year, week, start, end, reportCount, events, topPerformers, watchlistPerf } = data;
  const lines = [];
  
  const startDate = new Date(start).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
  const endDate = new Date(end).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' });
  
  lines.push(`📅 本週財經回顧（${startDate} - ${endDate}）`);
  lines.push(`🗓️  ${year} 第 ${week} 週`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 本週重大事件
  if (events.length > 0) {
    lines.push('🔥 本週重大事件');
    lines.push('');
    
    // 高優先級
    const highEvents = events.filter(e => e.priority === 'high');
    if (highEvents.length > 0) {
      highEvents.slice(0, 5).forEach((e, i) => {
        lines.push(`${i + 1}️⃣ ${e.text}`);
        lines.push(`   分類：${e.category}`);
        lines.push('');
      });
    }
    
    // 中優先級
    const mediumEvents = events.filter(e => e.priority === 'medium');
    if (mediumEvents.length > 0 && highEvents.length < 5) {
      const remaining = 5 - highEvents.length;
      mediumEvents.slice(0, remaining).forEach((e, i) => {
        lines.push(`${highEvents.length + i + 1}️⃣ ${e.text}`);
        lines.push(`   分類：${e.category}`);
        lines.push('');
      });
    }
  }
  
  // 漲幅前 5 名
  if (topPerformers.length > 0) {
    lines.push('📈 本週漲幅亮點');
    lines.push('');
    topPerformers.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.name}：+${p.pct}%`);
    });
    lines.push('');
  }
  
  // 我的關注股本週表現
  if (watchlistPerf.length > 0) {
    lines.push('⭐ 我的關注股本週表現');
    lines.push('');
    watchlistPerf.forEach(p => {
      const emoji = p.pct > 0 ? '📈' : '📉';
      const sign = p.pct > 0 ? '+' : '';
      lines.push(`${emoji} ${p.code} ${p.name}：${sign}${p.pct}%`);
    });
    lines.push('');
  }
  
  // 統計資訊
  lines.push('📊 本週統計');
  lines.push('');
  lines.push(`• 早報收集天數：${reportCount} 天`);
  lines.push(`• 重大事件：${events.length} 則`);
  lines.push(`• 高優先事件：${events.filter(e => e.priority === 'high').length} 則`);
  lines.push('');
  
  // 下週展望（TODO：從提醒中提取）
  lines.push('🔮 下週重點');
  lines.push('');
  lines.push('• （待整合提醒功能）');
  lines.push('');
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  lines.push(`📡 數據來源：LINE 群組早報（${start} ~ ${end}）`);
  
  return lines.join('\n');
}

/**
 * 推播週報
 */
function pushWeeklySummary(summary) {
  try {
    console.log('📤 推播週報中...');
    
    const tempFile = '/tmp/weekly-summary.txt';
    fs.writeFileSync(tempFile, summary);
    
    execSync(
      `clawdbot message send --channel telegram --target 1377531222 --message "$(cat ${tempFile})"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    
    console.log('✅ 週報已推播');
    
    // 記錄推播
    const logPath = path.join(__dirname, 'logs/weekly-summary.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logEntry = `${new Date().toISOString()} - 週報推播成功\n`;
    fs.appendFileSync(logPath, logEntry);
    
  } catch (err) {
    console.error(`❌ 推播失敗：${err.message}`);
    throw err;
  }
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2] || 'generate';
  
  if (command === 'generate') {
    const weekIndex = process.argv.indexOf('--week');
    const weekStr = weekIndex !== -1 ? process.argv[weekIndex + 1] : null;
    
    generateWeeklySummary(weekStr);
    
  } else if (command === 'push') {
    const weekIndex = process.argv.indexOf('--week');
    const weekStr = weekIndex !== -1 ? process.argv[weekIndex + 1] : null;
    
    const summary = generateWeeklySummary(weekStr);
    
    if (summary) {
      pushWeeklySummary(summary);
    } else {
      console.error('❌ 無法生成週報');
      process.exit(1);
    }
    
  } else {
    console.log(`
Weekly Summary - 週報自動匯總

指令：
  generate [--week YYYY-WNN]   生成週報（預設本週）
  push [--week YYYY-WNN]        生成並推播週報

範例：
  node weekly-summary.js generate
  node weekly-summary.js generate --week 2026-W05
  node weekly-summary.js push
    `);
  }
}

module.exports = { generateWeeklySummary, formatWeeklySummary, pushWeeklySummary };
