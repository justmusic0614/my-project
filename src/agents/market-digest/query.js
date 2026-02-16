#!/usr/bin/env node
// Query Tool - 快速檢索歷史早報
// 使用：node query.js --keyword "沃什" --days 7

const fs = require('fs');
const path = require('path');

/**
 * 搜尋 morning-collect 目錄中的訊息
 */
function searchMorningCollect(options) {
  const { keyword, stock, category, days = 7, count = false } = options;
  const results = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today - i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const filePath = path.join(__dirname, 'data/morning-collect', `${dateStr}.json`);
    
    if (!fs.existsSync(filePath)) {
      continue;
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      data.messages.forEach((msg, index) => {
        let match = false;
        
        // 關鍵字搜尋
        if (keyword && msg.content.includes(keyword)) {
          match = true;
        }
        
        // 個股搜尋（支援股票代號）
        if (stock && (msg.content.includes(stock) || msg.content.includes(`(${stock})`))) {
          match = true;
        }
        
        // 類別搜尋（粗略匹配）
        if (category) {
          const categoryMap = {
            '台股': ['台股', '加權指數', 'TAIEX', 'OTC'],
            '美股': ['美股', 'S&P', 'Nasdaq', '道瓊', 'DJI'],
            '匯率': ['台幣', '美元指數', 'USD', 'TWD'],
            '商品': ['黃金', '原油', 'WTI', '布蘭特'],
            '美債': ['殖利率', '公債', 'Treasury'],
            '科技': ['AI', '半導體', '晶片', '台積電', '輝達', '聯發科'],
          };
          
          const keywords = categoryMap[category] || [category];
          if (keywords.some(kw => msg.content.includes(kw))) {
            match = true;
          }
        }
        
        if (match) {
          results.push({
            date: dateStr,
            messageIndex: index,
            content: msg.content,
            timestamp: msg.timestamp
          });
        }
      });
    } catch (err) {
      console.error(`⚠️  讀取 ${dateStr} 失敗：${err.message}`);
    }
  }
  
  return results;
}

/**
 * 格式化輸出結果
 */
function formatResults(results, options) {
  const { count = false, keyword, stock, category } = options;
  
  if (results.length === 0) {
    console.log('❌ 未找到相關結果');
    return;
  }
  
  // 統計模式
  if (count) {
    const searchTerm = keyword || stock || category;
    console.log(`📊 「${searchTerm}」最近 ${options.days} 天出現 ${results.length} 次`);
    console.log('');
    
    // 按日期統計
    const dateCount = {};
    results.forEach(r => {
      dateCount[r.date] = (dateCount[r.date] || 0) + 1;
    });
    
    console.log('📅 每日分布：');
    Object.keys(dateCount).sort().reverse().forEach(date => {
      console.log(`  ${date}: ${dateCount[date]} 次`);
    });
    
    return;
  }
  
  // 詳細模式
  console.log(`🔍 找到 ${results.length} 筆結果（最近 ${options.days} 天）`);
  console.log('━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  // 按日期分組
  const grouped = {};
  results.forEach(r => {
    if (!grouped[r.date]) {
      grouped[r.date] = [];
    }
    grouped[r.date].push(r);
  });
  
  // 輸出（由新到舊）
  Object.keys(grouped).sort().reverse().forEach(date => {
    console.log(`📅 ${date}（${grouped[date].length} 筆）`);
    console.log('');
    
    grouped[date].forEach((result, index) => {
      // 截取相關段落（前後各 100 字）
      const content = result.content;
      let snippet = content;
      
      // 如果有關鍵字，高亮顯示
      if (keyword && content.includes(keyword)) {
        const keywordIndex = content.indexOf(keyword);
        const start = Math.max(0, keywordIndex - 100);
        const end = Math.min(content.length, keywordIndex + keyword.length + 100);
        snippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
        
        // 用 ANSI 顏色高亮關鍵字（Telegram 不支援，但 terminal 可以看）
        snippet = snippet.replace(new RegExp(keyword, 'g'), `\x1b[33m${keyword}\x1b[0m`);
      }
      
      // 限制長度（避免輸出過長）
      if (snippet.length > 500) {
        snippet = snippet.substring(0, 500) + '...';
      }
      
      console.log(`  ${index + 1}. ${snippet}`);
      console.log('');
    });
    
    console.log('');
  });
}

/**
 * 搜尋時間序列資料庫（data/timeseries/*.json）
 */
function searchTimeseries(options) {
  const { days = 7 } = options;
  const results = [];
  const timeseriesDir = path.join(__dirname, 'data/timeseries');
  
  if (!fs.existsSync(timeseriesDir)) {
    return results;
  }
  
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today - i * 86400000);
    const dateStr = date.toISOString().split('T')[0];
    const filePath = path.join(timeseriesDir, `${dateStr}.json`);
    
    if (!fs.existsSync(filePath)) {
      continue;
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // 搜尋報告內容
      if (options.keyword && data.report && data.report.includes(options.keyword)) {
        results.push({
          date: dateStr,
          report: data.report,
          metadata: data.metadata
        });
      }
    } catch (err) {
      console.error(`⚠️  讀取時間序列 ${dateStr} 失敗：${err.message}`);
    }
  }
  
  return results;
}

// CLI 模式
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // 解析參數
  const options = {
    keyword: null,
    stock: null,
    category: null,
    days: 7,
    count: false,
    timeseries: false
  };
  
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    
    if (flag === '--keyword') {
      options.keyword = value;
    } else if (flag === '--stock') {
      options.stock = value;
    } else if (flag === '--category') {
      options.category = value;
    } else if (flag === '--days') {
      options.days = parseInt(value, 10);
    } else if (flag === '--count') {
      options.count = true;
      i -= 1; // --count 沒有值
    } else if (flag === '--timeseries') {
      options.timeseries = true;
      i -= 1;
    } else if (flag === '--help' || flag === '-h') {
      console.log(`
Query Tool - 快速檢索歷史早報

使用方式：
  node query.js --keyword <關鍵字> [--days <天數>] [--count]
  node query.js --stock <股票代號> [--days <天數>]
  node query.js --category <類別> [--days <天數>]

參數說明：
  --keyword    搜尋關鍵字（如：沃什、Fed、降息）
  --stock      搜尋個股代號（如：2330、2454、2408）
  --category   搜尋類別（台股、美股、匯率、商品、美債、科技）
  --days       搜尋天數（預設 7 天）
  --count      只統計次數，不顯示內容
  --timeseries 搜尋生成的報告（data/timeseries/）

範例：
  # 搜尋「沃什」最近 7 天的新聞
  node query.js --keyword "沃什" --days 7
  
  # 搜尋台積電（2330）最近 30 天的提及
  node query.js --stock "2330" --days 30
  
  # 統計「聯發科」最近 7 天出現次數
  node query.js --keyword "聯發科" --days 7 --count
  
  # 搜尋「台股」類別最近 14 天的新聞
  node query.js --category "台股" --days 14
      `);
      process.exit(0);
    }
  }
  
  // 檢查必要參數
  if (!options.keyword && !options.stock && !options.category) {
    console.error('❌ 請指定搜尋條件（--keyword、--stock 或 --category）');
    console.error('💡 使用 --help 查看說明');
    process.exit(1);
  }
  
  // 執行搜尋
  try {
    if (options.timeseries) {
      const results = searchTimeseries(options);
      console.log(`🔍 時間序列搜尋結果：${results.length} 筆`);
      results.forEach(r => {
        console.log(`\n📅 ${r.date}`);
        console.log(r.report.substring(0, 500) + '...');
      });
    } else {
      const results = searchMorningCollect(options);
      formatResults(results, options);
    }
  } catch (err) {
    console.error(`❌ 搜尋失敗：${err.message}`);
    process.exit(1);
  }
}

module.exports = { searchMorningCollect, searchTimeseries };
