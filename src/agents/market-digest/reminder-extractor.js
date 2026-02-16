#!/usr/bin/env node
// Reminder Extractor - 從早報中提取關鍵數據提醒
// 使用：node reminder-extractor.js extract [--date YYYY-MM-DD]

const fs = require('fs');
const path = require('path');

/**
 * 從文字中提取日期與事件
 */
function extractReminders(text) {
  const reminders = [];
  
  // 模式 1：「2/3 (週二)：聯發科法說會」
  const pattern1 = /(\d{1,2})\/(\d{1,2})\s*\(([^)]+)\)[：:]\s*([^。\n]+)/g;
  let match;
  
  while ((match = pattern1.exec(text)) !== null) {
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const weekday = match[3];
    const event = match[4].trim();
    
    // 推算年份（假設是當年或明年）
    const now = new Date();
    let year = now.getFullYear();
    
    // 如果月份小於當前月份，可能是明年
    if (month < now.getMonth() + 1) {
      year += 1;
    }
    
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    reminders.push({
      date: dateStr,
      weekday,
      event,
      rawText: match[0]
    });
  }
  
  // 模式 2：「下周關鍵數據提醒」後的項目
  const reminderSections = text.match(/(?:下周|本周|近期)關鍵(?:數據|事件)提醒[：:]\s*([^*]{100,1000})/gi);
  
  if (reminderSections) {
    reminderSections.forEach(section => {
      // 再次套用 pattern1 到這個區塊
      let m;
      while ((m = pattern1.exec(section)) !== null) {
        const month = parseInt(m[1], 10);
        const day = parseInt(m[2], 10);
        const weekday = m[3];
        const event = m[4].trim();
        
        const now = new Date();
        let year = now.getFullYear();
        if (month < now.getMonth() + 1) {
          year += 1;
        }
        
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // 去重
        const exists = reminders.find(r => r.date === dateStr && r.event === event);
        if (!exists) {
          reminders.push({
            date: dateStr,
            weekday,
            event,
            rawText: m[0]
          });
        }
      }
    });
  }
  
  // 模式 3：「明日/明天/後天：xxx」
  const relativePatterns = [
    { regex: /(?:明日|明天)[：:]\s*([^。\n]{10,200})/g, offset: 1 },
    { regex: /後天[：:]\s*([^。\n]{10,200})/g, offset: 2 },
    { regex: /本週[一二三四五六日][：:]\s*([^。\n]{10,200})/g, offset: 0 },
  ];
  
  relativePatterns.forEach(({ regex, offset }) => {
    let m;
    while ((m = regex.exec(text)) !== null) {
      const event = m[1].trim();
      const now = new Date();
      const targetDate = new Date(now.getTime() + offset * 86400000);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      const exists = reminders.find(r => r.date === dateStr && r.event.includes(event.substring(0, 20)));
      if (!exists) {
        reminders.push({
          date: dateStr,
          weekday: '',
          event,
          rawText: m[0]
        });
      }
    }
  });
  
  return reminders;
}

/**
 * 分類提醒（重要性）
 */
function categorizeReminders(reminders) {
  const categories = {
    high: [],    // 重要經濟數據、央行決策
    medium: [],  // 法說會、企業財報
    low: []      // 一般事件
  };
  
  reminders.forEach(reminder => {
    const event = reminder.event.toLowerCase();
    
    // 高優先級關鍵字
    const highKeywords = [
      '非農', 'nonfarm', '就業數據',
      'fed', '聯準會', '央行', '利率決策',
      'gdp', 'cpi', 'ppi', '通膨',
      '封關', '開紅盤'
    ];
    
    // 中優先級關鍵字
    const mediumKeywords = [
      '法說會', 'earnings',
      '財報', 'financial report',
      '除息', '配息',
      '領現', '賣出日'
    ];
    
    const isHigh = highKeywords.some(kw => event.includes(kw));
    const isMedium = mediumKeywords.some(kw => event.includes(kw));
    
    if (isHigh) {
      categories.high.push(reminder);
    } else if (isMedium) {
      categories.medium.push(reminder);
    } else {
      categories.low.push(reminder);
    }
  });
  
  return categories;
}

/**
 * 儲存提醒到檔案
 */
function saveReminders(reminders, date) {
  const reminderDir = path.join(__dirname, 'data/reminders');
  if (!fs.existsSync(reminderDir)) {
    fs.mkdirSync(reminderDir, { recursive: true });
  }
  
  const filePath = path.join(reminderDir, `${date}.json`);
  
  const data = {
    extractedDate: date,
    extractedAt: new Date().toISOString(),
    reminders: reminders,
    categorized: categorizeReminders(reminders)
  };
  
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`✅ 提醒已儲存：${filePath}`);
  console.log(`   總計：${reminders.length} 則`);
  console.log(`   高優先：${data.categorized.high.length} 則`);
  console.log(`   中優先：${data.categorized.medium.length} 則`);
  console.log(`   低優先：${data.categorized.low.length} 則`);
  
  return filePath;
}

/**
 * 從 morning-collect 提取提醒
 */
function extractFromMorningCollect(date) {
  const collectPath = path.join(__dirname, 'data/morning-collect', `${date}.json`);
  
  if (!fs.existsSync(collectPath)) {
    console.error(`❌ 找不到早報檔案：${collectPath}`);
    return [];
  }
  
  const data = JSON.parse(fs.readFileSync(collectPath, 'utf8'));
  const allText = data.messages.map(m => m.content).join('\n\n');
  
  const reminders = extractReminders(allText);
  console.log(`📝 從 ${date} 早報提取到 ${reminders.length} 則提醒`);
  
  // 顯示提醒
  reminders.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.date} (${r.weekday}): ${r.event.substring(0, 80)}${r.event.length > 80 ? '...' : ''}`);
  });
  
  return reminders;
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'extract') {
    // 解析 --date 參數
    const dateIndex = process.argv.indexOf('--date');
    const date = dateIndex !== -1 && process.argv[dateIndex + 1]
      ? process.argv[dateIndex + 1]
      : new Date().toISOString().split('T')[0];
    
    console.log(`🔍 提取 ${date} 的提醒...`);
    
    const reminders = extractFromMorningCollect(date);
    
    if (reminders.length > 0) {
      saveReminders(reminders, date);
    } else {
      console.log('⚠️  未找到提醒');
    }
    
  } else if (command === 'list') {
    // 列出所有提醒
    const reminderDir = path.join(__dirname, 'data/reminders');
    if (!fs.existsSync(reminderDir)) {
      console.log('❌ 尚未提取任何提醒');
      process.exit(0);
    }
    
    const files = fs.readdirSync(reminderDir).filter(f => f.endsWith('.json'));
    
    console.log(`📅 已儲存的提醒檔案（${files.length} 個）：`);
    files.sort().reverse().forEach(file => {
      const filePath = path.join(reminderDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log(`\n📁 ${file}（${data.reminders.length} 則）`);
      data.reminders.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.date}: ${r.event.substring(0, 60)}`);
      });
    });
    
  } else {
    console.log(`
Reminder Extractor - 提醒提取器

指令：
  extract [--date YYYY-MM-DD]   從早報提取提醒（預設今天）
  list                           列出所有已儲存的提醒

範例：
  node reminder-extractor.js extract
  node reminder-extractor.js extract --date 2026-02-02
  node reminder-extractor.js list
    `);
  }
}

module.exports = { extractReminders, categorizeReminders, saveReminders };
