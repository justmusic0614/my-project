#!/usr/bin/env node
// Morning Collector - 收集 08:00-08:10 的 LINE 群組早報
// 用於整合到 Market Digest

const fs = require('fs');
const path = require('path');

const COLLECT_DIR = path.join(__dirname, 'data/morning-collect');
const TODAY = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// 確保目錄存在
if (!fs.existsSync(COLLECT_DIR)) {
  fs.mkdirSync(COLLECT_DIR, { recursive: true });
}

const COLLECT_FILE = path.join(COLLECT_DIR, `${TODAY}.json`);

/**
 * 初始化收集檔案
 */
function initCollectFile() {
  if (!fs.existsSync(COLLECT_FILE)) {
    const initialData = {
      date: TODAY,
      messages: [],
      images: [],
      collected_at: new Date().toISOString()
    };
    fs.writeFileSync(COLLECT_FILE, JSON.stringify(initialData, null, 2));
  }
}

/**
 * 新增文字訊息
 */
function addTextMessage(text, timestamp = new Date().toISOString()) {
  initCollectFile();
  const data = JSON.parse(fs.readFileSync(COLLECT_FILE, 'utf8'));
  
  data.messages.push({
    type: 'text',
    content: text,
    timestamp
  });
  
  fs.writeFileSync(COLLECT_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ 收集文字訊息 (${text.length} 字元)`);
}

/**
 * 新增圖片訊息
 */
function addImageMessage(imagePath, timestamp = new Date().toISOString()) {
  initCollectFile();
  const data = JSON.parse(fs.readFileSync(COLLECT_FILE, 'utf8'));
  
  data.images.push({
    type: 'image',
    path: imagePath,
    timestamp
  });
  
  fs.writeFileSync(COLLECT_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ 收集圖片訊息 (${imagePath})`);
}

/**
 * 清空今日收集
 */
function clearToday() {
  if (fs.existsSync(COLLECT_FILE)) {
    fs.unlinkSync(COLLECT_FILE);
    console.log('🗑️ 已清空今日收集');
  }
}

/**
 * 讀取今日收集
 */
function getToday() {
  if (!fs.existsSync(COLLECT_FILE)) {
    return { date: TODAY, messages: [], images: [] };
  }
  return JSON.parse(fs.readFileSync(COLLECT_FILE, 'utf8'));
}

/**
 * 檢查是否在收集時段（08:00-08:10）
 */
function isCollectTime() {
  const now = new Date();
  const hour = now.getUTCHours() + 8; // UTC+8 台北時間
  const minute = now.getUTCMinutes();
  
  // 08:00-08:10 台北時間
  return (hour === 8 || (hour === 0 && minute >= 0 && minute < 10));
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  switch (command) {
    case 'add-text':
      if (!arg) {
        console.error('用法: morning-collector.js add-text "訊息內容"');
        process.exit(1);
      }
      addTextMessage(arg);
      break;
      
    case 'add-image':
      if (!arg) {
        console.error('用法: morning-collector.js add-image /path/to/image.jpg');
        process.exit(1);
      }
      addImageMessage(arg);
      break;
      
    case 'clear':
      clearToday();
      break;
      
    case 'show':
      const data = getToday();
      console.log(JSON.stringify(data, null, 2));
      break;
      
    case 'status':
      const status = getToday();
      console.log(`📅 日期：${status.date}`);
      console.log(`📝 文字訊息：${status.messages.length} 則`);
      console.log(`🖼️ 圖片訊息：${status.images.length} 張`);
      console.log(`⏰ 收集時段：${isCollectTime() ? '是' : '否'}`);
      break;
      
    default:
      console.log(`
Morning Collector - LINE 群組早報收集器

指令：
  add-text "訊息"   新增文字訊息
  add-image <路徑>  新增圖片訊息
  show              顯示今日收集
  status            顯示狀態
  clear             清空今日收集
      `);
  }
}

module.exports = {
  addTextMessage,
  addImageMessage,
  clearToday,
  getToday,
  isCollectTime
};
