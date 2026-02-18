#!/usr/bin/env node
// Reminder Checker - 檢查明天是否有重要提醒並推播
// 使用：node reminder-checker.js [--dry-run]
// Cron: 0 12 * * * (每天 20:00 台北時間)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * 讀取提醒檔案
 */
function loadReminders(date) {
  const reminderPath = path.join(__dirname, 'data/reminders', `${date}.json`);
  
  if (!fs.existsSync(reminderPath)) {
    return null;
  }
  
  return JSON.parse(fs.readFileSync(reminderPath, 'utf8'));
}

/**
 * 查找明天的提醒
 */
function getTomorrowReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  
  console.log(`🔍 查找 ${tomorrowStr} 的提醒...`);
  
  // 搜尋所有提醒檔案
  const reminderDir = path.join(__dirname, 'data/reminders');
  if (!fs.existsSync(reminderDir)) {
    console.log('⚠️  提醒目錄不存在');
    return [];
  }
  
  const files = fs.readdirSync(reminderDir).filter(f => f.endsWith('.json'));
  const tomorrowReminders = [];
  
  files.forEach(file => {
    const filePath = path.join(reminderDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    data.reminders.forEach(r => {
      if (r.date === tomorrowStr) {
        // 加上優先級
        let priority = 'low';
        if (data.categorized.high.some(hr => hr.date === r.date && hr.event === r.event)) {
          priority = 'high';
        } else if (data.categorized.medium.some(mr => mr.date === r.date && mr.event === r.event)) {
          priority = 'medium';
        }
        
        tomorrowReminders.push({
          ...r,
          priority,
          source: file
        });
      }
    });
  });
  
  // 按優先級排序
  tomorrowReminders.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
  
  return tomorrowReminders;
}

/**
 * 生成提醒通知訊息
 */
function generateReminderMessage(reminders) {
  if (reminders.length === 0) {
    return null;
  }
  
  const lines = [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  
  lines.push('⏰ 明日提醒');
  lines.push(`📅 ${tomorrowStr}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 高優先級
  const high = reminders.filter(r => r.priority === 'high');
  if (high.length > 0) {
    lines.push('🔴 重要經濟數據');
    lines.push('');
    high.forEach(r => {
      lines.push(`📢 ${r.event}`);
      
      // 加上影響說明
      const impact = getImpactDescription(r.event);
      if (impact) {
        lines.push(`  💡 ${impact}`);
      }
      lines.push('');
    });
  }
  
  // 中優先級
  const medium = reminders.filter(r => r.priority === 'medium');
  if (medium.length > 0) {
    lines.push('🟡 重要事件');
    lines.push('');
    medium.forEach(r => {
      lines.push(`📊 ${r.event}`);
      
      // 提取相關個股
      const stocks = extractStocks(r.event);
      if (stocks.length > 0) {
        lines.push(`  💼 相關個股：${stocks.join('、')}`);
      }
      lines.push('');
    });
  }
  
  // 低優先級（簡化顯示）
  const low = reminders.filter(r => r.priority === 'low');
  if (low.length > 0) {
    lines.push('🔵 其他事件');
    lines.push('');
    low.forEach(r => {
      lines.push(`  • ${r.event}`);
    });
    lines.push('');
  }
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('💡 提醒：請提前規劃交易策略');
  
  return lines.join('\n');
}

/**
 * 取得影響說明
 */
function getImpactDescription(event) {
  const eventLower = event.toLowerCase();
  
  if (eventLower.includes('非農') || eventLower.includes('nonfarm') || eventLower.includes('就業')) {
    return '影響美股與台幣匯率，對台股影響較大';
  }
  
  if (eventLower.includes('fed') || eventLower.includes('聯準會') || eventLower.includes('利率')) {
    return '影響全球市場走勢與資金流向';
  }
  
  if (eventLower.includes('cpi') || eventLower.includes('通膨')) {
    return '影響降息預期與市場情緒';
  }
  
  if (eventLower.includes('gdp')) {
    return '反映經濟成長動能';
  }
  
  if (eventLower.includes('封關') || eventLower.includes('開紅盤')) {
    return '台股重要節點，請留意資金動向';
  }
  
  return null;
}

/**
 * 提取個股代號或名稱
 */
function extractStocks(event) {
  const stocks = [];
  
  // 常見個股名稱
  const stockNames = {
    '台積電': '2330',
    '聯發科': '2454',
    '鴻海': '2317',
    '南亞科': '2408',
    '日月光': '2311',
    '欣興': '3037',
    '臻鼎': '4958',
    '大立光': '3008',
    '聯電': '2303',
    '廣達': '2382',
  };
  
  Object.entries(stockNames).forEach(([name, code]) => {
    if (event.includes(name)) {
      stocks.push(`${name}(${code})`);
    }
  });
  
  // 提取股票代號（4 位數字）
  const codeMatches = event.match(/\b\d{4}\b/g);
  if (codeMatches) {
    codeMatches.forEach(code => {
      if (!stocks.some(s => s.includes(code))) {
        stocks.push(code);
      }
    });
  }
  
  return stocks;
}

/**
 * 推播提醒
 */
function pushReminder(message, dryRun = false) {
  if (dryRun) {
    console.log('🧪 DRY RUN 模式（不實際推播）');
    console.log('━━━━━━━━━━━━━━━━━━');
    console.log(message);
    console.log('━━━━━━━━━━━━━━━━━━');
    return;
  }
  
  try {
    // 寫到暫存檔案
    const tempFile = '/tmp/reminder.txt';
    fs.writeFileSync(tempFile, message);
    
    // 推播到 Telegram
    console.log('📤 推播提醒中...');
    execSync(
      `clawdbot message send --channel telegram --target ${process.env.TELEGRAM_CHAT_ID} --message "$(cat ${tempFile})"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    
    console.log('✅ 提醒已推播');
    
    // 記錄推播
    const logPath = path.join(__dirname, 'logs/reminder.log');
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logEntry = `${new Date().toISOString()} - 推播成功\n`;
    fs.appendFileSync(logPath, logEntry);
    
  } catch (err) {
    console.error(`❌ 推播失敗：${err.message}`);
    throw err;
  }
}

// CLI 模式
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  
  try {
    const reminders = getTomorrowReminders();
    
    if (reminders.length === 0) {
      console.log('ℹ️  明天沒有提醒事項');
      process.exit(0);
    }
    
    console.log(`✅ 找到 ${reminders.length} 則明日提醒`);
    reminders.forEach((r, i) => {
      console.log(`   ${i + 1}. [${r.priority.toUpperCase()}] ${r.event}`);
    });
    console.log('');
    
    const message = generateReminderMessage(reminders);
    pushReminder(message, dryRun);
    
  } catch (err) {
    console.error('❌ 執行失敗:', err.message);
    process.exit(1);
  }
}

module.exports = { getTomorrowReminders, generateReminderMessage, pushReminder };
