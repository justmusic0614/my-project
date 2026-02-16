#!/usr/bin/env node
/**
 * integrate-daily-brief-with-news.js
 * 整合 LINE 早報 + 自動新聞抓取
 */

const fs = require('fs');
const path = require('path');
const { fetchAllNews } = require('./news-fetcher');

const DATA_DIR = path.join(__dirname, 'data');
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
const OUTPUT_FILE = path.join(RUNTIME_DIR, 'morning-report.txt');

// 檢查 LINE 早報是否存在
function checkLineReport() {
  const today = new Date().toISOString().split('T')[0];
  const reportFile = path.join(RUNTIME_DIR, `morning-${today}.json`);
  
  if (fs.existsSync(reportFile)) {
    const data = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (data.messages && data.messages.length > 0) {
      console.log(`✅ 發現 LINE 早報：${data.messages.length} 則`);
      return data.messages;
    }
  }
  
  console.log('⚠️ 無 LINE 早報，啟動自動新聞抓取');
  return null;
}

// 生成 Daily Brief（LINE 模式）
function generateBriefFromLine(messages) {
  let brief = `📰 Daily Market Brief | ${new Date().toLocaleDateString('zh-TW')}\n`;
  brief += `📍 資料來源：LINE 手動收集（HIGH 信心度）\n\n`;
  
  messages.forEach((msg, i) => {
    brief += `${i + 1}. ${msg.text || msg.content}\n`;
    if (msg.image) brief += `   🖼️ 附圖\n`;
    brief += `\n`;
  });
  
  return brief;
}

// 生成 Daily Brief（自動新聞模式）
async function generateBriefFromNews() {
  const newsData = await fetchAllNews();
  
  let brief = `📰 Daily Market Brief | ${new Date().toLocaleDateString('zh-TW')}\n`;
  brief += `📍 資料來源：自動新聞抓取（工商時報、Yahoo Finance、CNBC、Investing.com）\n`;
  brief += `⚠️ 建議：有真實早報時效果更佳（MEDIUM 信心度）\n\n`;
  
  // 依類別分組
  const byCategory = {};
  newsData.news.forEach(n => {
    if (!byCategory[n.category]) byCategory[n.category] = [];
    byCategory[n.category].push(n);
  });
  
  // Taiwan_Market
  if (byCategory.Taiwan_Market) {
    brief += `## 📌 台股市場\n\n`;
    byCategory.Taiwan_Market.slice(0, 8).forEach((n, i) => {
      brief += `${i + 1}. ${n.title}\n`;
      brief += `   來源：${n.source}\n\n`;
    });
  }
  
  // Equity_Market
  if (byCategory.Equity_Market) {
    brief += `## 🌍 國際市場\n\n`;
    byCategory.Equity_Market.slice(0, 8).forEach((n, i) => {
      brief += `${i + 1}. ${n.title}\n`;
      brief += `   來源：${n.source}\n\n`;
    });
  }
  
  brief += `\n💡 提示：如有遺漏重要消息，可手動補充：\n`;
  brief += `   node morning-collector.js add-text "消息內容"\n`;
  
  return brief;
}

// 主函數
async function main() {
  console.log('=== Daily Brief 整合器（含自動新聞） ===\n');
  
  const lineMessages = checkLineReport();
  let brief;
  
  if (lineMessages) {
    brief = generateBriefFromLine(lineMessages);
  } else {
    brief = await generateBriefFromNews();
  }
  
  // 儲存
  fs.writeFileSync(OUTPUT_FILE, brief, 'utf8');
  console.log(`\n✅ Daily Brief 已生成：${OUTPUT_FILE}`);
  console.log(`\n--- 預覽 ---\n${brief.substring(0, 500)}...\n`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
