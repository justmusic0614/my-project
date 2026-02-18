#!/usr/bin/env node
// @deprecated 2026-02-17 - Plan A 已棄用，改用 smart-integrator.js（Plan B 統一晨報）
// 使用 `node smart-integrator.js push --level standard` 取代
// 將於穩定運行一週後刪除
//
// Morning Integrator - 整合 LINE 群組早報 + Market Digest
// 方案 A：原樣保留 LINE 群組內容，下方補充 Market Digest

// 全局錯誤處理器 - SRE 版本
const errorHandler = require('./global-error-handler');
errorHandler.install({
  appName: 'morning-integrator',
  logDir: require('path').join(__dirname, 'logs'),
  maxErrorRate: 10
});

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const collector = require('./morning-collector');
const MarketDataFetcher = require('./backend/fetcher');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const { renderReport } = require('./institutional-renderer');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

/**
 * 從圖片提取新聞內容（使用 Clawdbot image tool）
 */
async function extractImageContent(imagePath) {
  try {
    // 調用 clawdbot CLI 的 image 工具
    const { execSync } = require('child_process');
    
    const prompt = `這是一張財經新聞截圖。請提取以下資訊（用繁體中文回答）：
1. 主要新聞標題（1-3 個最重要的）
2. 關鍵數據（台股、美股、匯率、商品等）
3. 重要事件摘要

請用以下格式回答：
標題：<標題1>
標題：<標題2>
數據：<關鍵數據>
摘要：<簡短摘要>`;

    const result = execSync(
      `clawdbot image analyze --image "${imagePath}" --prompt "${prompt.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
    );
    
    // 解析結果
    const titles = [];
    let summary = '';
    const lines = result.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('標題：')) {
        titles.push(line.replace('標題：', '').trim());
      } else if (line.startsWith('摘要：')) {
        summary = line.replace('摘要：', '').trim();
      }
    }
    
    const title = titles.length > 0 ? titles[0] : '（圖片新聞）';
    
    return {
      title,
      summary: summary || title,
      titles,
      raw: result
    };
    
  } catch (err) {
    console.error(`⚠️  提取圖片內容失敗：${err.message}`);
    
    // 提供診斷資訊
    if (err.killed) {
      console.error('   原因：執行超時（30秒）');
    } else if (err.code === 'ENOENT') {
      console.error('   原因：找不到 clawdbot 指令');
    }
    
    return {
      title: '（圖片處理失敗）',
      summary: `無法處理圖片: ${err.message}`,
      titles: [],
      raw: ''
    };
  }
}

/**
 * 生成 LINE 群組早報區塊
 */
async function generateLineSection() {
  const collected = collector.getToday();
  
  if (collected.messages.length === 0 && collected.images.length === 0) {
    return null; // 沒有收集到內容
  }
  
  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('📌 LINE 群組早報');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 文字訊息（原樣保留）
  for (const msg of collected.messages) {
    lines.push(msg.content);
    lines.push('');
  }
  
  // 圖片訊息（提取摘要）
  if (collected.images.length > 0) {
    lines.push('📰 圖片新聞摘要：');
    for (const img of collected.images) {
      const content = await extractImageContent(img.path);
      lines.push(`• ${content.title}`);
      if (content.summary && content.summary !== content.title) {
        lines.push(`  ${content.summary}`);
      }
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * 生成 Market Digest 區塊
 */
async function generateMarketDigestSection() {
  try {
    const generator = new RuntimeInputGenerator(config);
    const runtimeInput = await generator.generate();
    const report = renderReport(runtimeInput);
    
    const lines = [];
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('📊 Market Digest 自動摘要');
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push(report);
    
    return lines.join('\n');
  } catch (err) {
    console.error(`Market Digest 生成失敗：${err.message}`);
    return `━━━━━━━━━━━━━━━━━━
📊 Market Digest 自動摘要
━━━━━━━━━━━━━━━━━━

❌ 生成失敗：${err.message}`;
  }
}

/**
 * 整合完整報告
 */
async function integrate() {
  console.log('🔄 開始整合早報...');
  
  const sections = [];
  
  // 標題
  const now = new Date();
  const dateStr = now.toLocaleString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const timeStr = now.toLocaleTimeString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  sections.push('🌅 每日財經匯總');
  sections.push(`📅 ${dateStr} ${timeStr}`);
  sections.push('');
  
  // LINE 群組早報區塊
  const lineSection = await generateLineSection();
  if (lineSection) {
    sections.push(lineSection);
  }
  
  // Market Digest 區塊
  const marketSection = await generateMarketDigestSection();
  sections.push(marketSection);
  
  // 免責聲明
  sections.push('');
  sections.push('━━━━━━━━━━━━━━━━━━');
  sections.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  sections.push('📡 數據來源：LINE 群組 + TWSE + Yahoo Finance + Bloomberg');
  
  const fullReport = sections.join('\n');
  
  // 儲存報告
  const outputPath = path.join(__dirname, 'data/runtime/morning-report.txt');
  fs.writeFileSync(outputPath, fullReport);
  
  console.log(`✅ 報告已生成：${outputPath}`);
  console.log(`📏 長度：${fullReport.length} 字元`);
  
  return fullReport;
}

/**
 * 整合並推播
 */
async function integrateAndPush() {
  try {
    const report = await integrate();
    
    // 推播到 Telegram
    console.log('📤 推播中...');
    
    const result = execSync(
      `clawdbot message send --channel telegram --target REDACTED_CHAT_ID --message "${report.replace(/"/g, '\\"')}"`,
      { 
        encoding: 'utf8', 
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000 // 30 秒超時
      }
    );
    
    console.log('✅ 推播成功');
    return report;
    
  } catch (err) {
    console.error(`❌ 整合或推播失敗：${err.message}`);
    
    // 如果是 timeout，提供建議
    if (err.code === 'ETIMEDOUT' || err.killed) {
      console.error('⚠️  推播超時（30秒），可能是：');
      console.error('   1. Telegram API 回應緩慢');
      console.error('   2. 報告內容過長');
      console.error('   3. 網路連線問題');
      console.error('   建議：檢查報告長度或稍後重試');
    }
    
    throw err;
  }
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2] || 'integrate';
  
  if (command === 'integrate') {
    integrate().catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else if (command === 'push') {
    integrateAndPush().catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.log(`
Morning Integrator - 早報整合器

指令：
  integrate   生成整合報告（不推播）
  push        生成並推播到 Telegram
    `);
  }
}

module.exports = { integrate, integrateAndPush };
