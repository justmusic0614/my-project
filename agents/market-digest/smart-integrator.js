#!/usr/bin/env node
// Smart Integrator - 智慧整合 LINE 群組早報 + Market Digest
// 方案 B：提取關鍵資訊、去重、統一格式

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const collector = require('./morning-collector');
const MarketDataFetcher = require('./backend/fetcher');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const { applyPatch } = require('./patch-minimal-upgrade-v1');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

/**
 * 從 LINE 早報提取市場數據
 */
function extractMarketData(text) {
  const data = {
    tw_stock: null,
    us_stock: {},
    fx: {},
    commodities: {},
    vix: null
  };
  
  // 台股
  const twMatch = text.match(/(?:台股|加權指數)[：:]\s*([0-9,]+(?:\.[0-9]+)?)\s*(?:點)?.*?(?:漲|跌|[-+])\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (twMatch) {
    data.tw_stock = {
      index: parseFloat(twMatch[1].replace(/,/g, '')),
      change: parseFloat(twMatch[2].replace(/,/g, ''))
    };
  }
  
  // 成交量
  const volMatch = text.match(/成交(?:金)?額[：:]\s*([0-9,]+(?:\.[0-9]+)?)\s*億/i);
  if (volMatch) {
    if (!data.tw_stock) data.tw_stock = {};
    data.tw_stock.volume = parseFloat(volMatch[1].replace(/,/g, ''));
  }
  
  // S&P 500
  const spMatch = text.match(/S&P\s*500[：:]\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (spMatch) {
    data.us_stock.sp500 = parseFloat(spMatch[1].replace(/,/g, ''));
  }
  
  // Nasdaq
  const nasdaqMatch = text.match(/(?:那斯達克|納指|NASDAQ)[：:]\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (nasdaqMatch) {
    data.us_stock.nasdaq = parseFloat(nasdaqMatch[1].replace(/,/g, ''));
  }
  
  // 道瓊
  const dowMatch = text.match(/道瓊[：:]\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (dowMatch) {
    data.us_stock.dow = parseFloat(dowMatch[1].replace(/,/g, ''));
  }
  
  // 美元指數
  const dxyMatch = text.match(/美元指數[：:]\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (dxyMatch) {
    data.fx.dxy = parseFloat(dxyMatch[1].replace(/,/g, ''));
  }
  
  // 台幣
  const twdMatch = text.match(/台幣[：:]\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (twdMatch) {
    data.fx.usdtwd = parseFloat(twdMatch[1].replace(/,/g, ''));
  }
  
  // 黃金（支持 5,399 或 5399 格式）
  const goldMatch = text.match(/(?:黃金|金價)[：:]\s*(?:\$)?([0-9,]+(?:\.[0-9]+)?)/i);
  if (goldMatch) {
    data.commodities.gold = parseFloat(goldMatch[1].replace(/,/g, ''));
  }
  
  // 原油（支持 65.43 或 65 格式）
  const oilMatch = text.match(/(?:原油|油價|WTI)[：:]\s*(?:\$)?([0-9,]+(?:\.[0-9]+)?)/i);
  if (oilMatch) {
    data.commodities.oil = parseFloat(oilMatch[1].replace(/,/g, ''));
  }
  
  // VIX
  const vixMatch = text.match(/VIX[：:]\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (vixMatch) {
    data.vix = parseFloat(vixMatch[1].replace(/,/g, ''));
  }
  
  return data;
}

/**
 * 從 LINE 早報提取新聞標題
 */
function extractNews(text) {
  const news = [];
  
  // 排除市場數據行的關鍵字
  const dataKeywords = [
    '指數', '收盤', '成交量', '殖利率', '漲幅', '跌幅',
    '💵', '🥇', '🛢️', '📊', '📈', '📉'
  ];
  
  // 匹配常見的新聞格式
  const patterns = [
    /[•●▪︎▫︎◦‣⁃]\s*(.+?)(?:\n|$)/g,  // bullet points
    /[✅☑️]\s*(.+?)(?:\n|$)/g,         // checkmarks
    /^\d+[、.）)]?\s*(.+?)$/gm,         // numbered lists (1、2、etc)
    /💡\s*(.+?)$/gm,                   // 💡 開頭
    /[-−]\s*(.+?)$/gm,                 // - 開頭
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const title = match[1].trim();
      
      // 過濾條件
      const isValidLength = title.length > 10 && title.length < 300;
      
      // 更寬鬆的數據行判斷：只排除明確的數據格式
      const hasNumberPattern = /^\d+\.\d+%?$|^[0-9,]+點$|^[0-9,]+億$/.test(title);
      const startsWithDataKeyword = dataKeywords.some(kw => title.startsWith(kw));
      const isNotDataLine = !hasNumberPattern && !startsWithDataKeyword;
      
      // 排除純符號或太短的內容
      const hasSubstantiveContent = title.replace(/[^\w\u4e00-\u9fa5]/g, '').length > 8;
      
      if (isValidLength && isNotDataLine && hasSubstantiveContent) {
        news.push(title);
      }
    }
  }
  
  // 額外提取段落標題（如「台股重點」「本週關鍵趨勢」）
  const sectionTitles = text.match(/(?:台股|美股|本週|今日|市場)[\w\s]{2,15}[:：]/g);
  if (sectionTitles) {
    sectionTitles.forEach(title => {
      const clean = title.replace(/[:：]$/, '').trim();
      if (clean.length > 4 && clean.length < 20) {
        // 不加入，這些是標題而非新聞
      }
    });
  }
  
  return [...new Set(news)]; // 去重
}

/**
 * 新聞去重（與 Market Digest 比較）
 */
function deduplicateNews(lineNews, marketDigestNews) {
  const unique = [];
  
  for (const lineItem of lineNews) {
    let isDuplicate = false;
    
    for (const mdItem of marketDigestNews) {
      // 簡單的相似度判斷（關鍵字重疊）
      const lineWords = lineItem.split(/\s+/).filter(w => w.length > 2);
      const mdWords = mdItem.split(/\s+/).filter(w => w.length > 2);
      const overlap = lineWords.filter(w => mdWords.includes(w)).length;
      
      if (overlap > 3) {
        isDuplicate = true;
        break;
      }
    }
    
    if (!isDuplicate) {
      unique.push(lineItem);
    }
  }
  
  return unique;
}

/**
 * 生成智慧整合報告
 */
async function smartIntegrate() {
  console.log('🔄 開始智慧整合...');
  
  // 1. 讀取 LINE 早報
  const collected = collector.getToday();
  const allText = collected.messages.map(m => m.content).join('\n\n');
  
  // 2. 提取 LINE 早報的關鍵資訊
  const lineMarketData = extractMarketData(allText);
  const lineNews = extractNews(allText);
  
  console.log(`📝 LINE 早報：${collected.messages.length} 則，提取 ${lineNews.length} 條新聞`);
  
  // 3. 生成 Market Digest
  let marketDigest = null;
  let marketNews = [];
  
  try {
    const generator = new RuntimeInputGenerator(config);
    const runtimeInput = await generator.generate();
    
    marketDigest = runtimeInput;
    
    // 提取 Market Digest 的新聞（從 normalized_market_summary）
    if (runtimeInput.normalized_market_summary) {
      marketNews = runtimeInput.normalized_market_summary.filter(item => 
        !item.includes('TAIEX') && !item.includes('S&P') && !item.includes('USD')
      );
    }
  } catch (err) {
    console.error(`⚠️  Market Digest 生成失敗：${err.message}`);
  }
  
  // 4. 新聞去重
  const uniqueLineNews = deduplicateNews(lineNews, marketNews);
  console.log(`🔍 去重後 LINE 新聞：${uniqueLineNews.length} 條`);
  
  // 4.5. 套用 patch: minimal_upgrade_news_to_research_signal v1
  const patchResult = applyPatch(uniqueLineNews, marketDigest);
  const finalNews = patchResult.events;
  const marketRegime = patchResult.regime;
  
  // 5. 生成整合報告
  const report = generateIntegratedReport(lineMarketData, finalNews, marketDigest, marketRegime);
  
  // 6. 儲存報告
  const outputPath = path.join(__dirname, 'data/runtime/morning-report.txt');
  fs.writeFileSync(outputPath, report);
  
  console.log(`✅ 智慧整合完成：${outputPath}`);
  console.log(`📏 長度：${report.length} 字元`);
  
  return report;
}

/**
 * 生成整合報告（統一格式）
 */
function generateIntegratedReport(lineData, lineNews, marketDigest, marketRegime = null) {
  const lines = [];
  
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
  
  lines.push('🌅 每日財經匯總');
  lines.push(`📅 ${dateStr} ${timeStr}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // 📈 市場數據區塊
  lines.push('📈 市場概況');
  lines.push('');
  
  // 台股（優先用 LINE 資料）
  if (lineData.tw_stock) {
    const tw = lineData.tw_stock;
    const sign = tw.change >= 0 ? '▲' : '▼';
    lines.push(`• 台股加權指數：${tw.index?.toLocaleString() || 'N/A'} ${sign}${Math.abs(tw.change || 0)}`);
    if (tw.volume) {
      lines.push(`  成交量：${tw.volume.toLocaleString()} 億元`);
    }
  } else if (marketDigest?.verified_key_data?.tw_stock) {
    const tw = marketDigest.verified_key_data.tw_stock;
    const sign = tw.taiex_change_pct >= 0 ? '▲' : '▼';
    lines.push(`• 台股加權指數：${tw.taiex_close?.toLocaleString() || 'N/A'} ${sign}${Math.abs(tw.taiex_change_pct || 0)}%`);
  }
  
  // 技術指標（來自 Market Digest）
  if (marketDigest?.verified_key_data?.tw_stock) {
    const tw = marketDigest.verified_key_data.tw_stock;
    if (tw.ma5) {
      lines.push(`  技術指標：MA5 ${tw.ma5} | MA20 ${tw.ma20} | RSI ${tw.rsi}`);
    }
  }
  
  // 美股
  if (lineData.us_stock.sp500 || lineData.us_stock.nasdaq || lineData.us_stock.dow) {
    if (lineData.us_stock.sp500) {
      lines.push(`• S&P 500：${lineData.us_stock.sp500.toLocaleString()}`);
    }
    if (lineData.us_stock.nasdaq) {
      lines.push(`• Nasdaq：${lineData.us_stock.nasdaq.toLocaleString()}`);
    }
    if (lineData.us_stock.dow) {
      lines.push(`• 道瓊：${lineData.us_stock.dow.toLocaleString()}`);
    }
  } else if (marketDigest?.verified_key_data?.us_stock) {
    const us = marketDigest.verified_key_data.us_stock;
    lines.push(`• S&P 500：${us.sp500_close?.toLocaleString() || 'N/A'} (${us.sp500_change_pct >= 0 ? '+' : ''}${us.sp500_change_pct}%)`);
  }
  
  // 匯率
  if (lineData.fx.usdtwd || lineData.fx.dxy) {
    if (lineData.fx.usdtwd) {
      lines.push(`• 台幣：${lineData.fx.usdtwd}`);
    }
    if (lineData.fx.dxy) {
      lines.push(`• 美元指數：${lineData.fx.dxy}`);
    }
  } else if (marketDigest?.verified_key_data?.fx) {
    const fx = marketDigest.verified_key_data.fx;
    const sign = fx.usdtwd_change_pct >= 0 ? '貶' : '升';
    lines.push(`• 台幣：${fx.usdtwd} (${sign}${Math.abs(fx.usdtwd_change_pct)}%)`);
  }
  
  // 商品
  if (lineData.commodities.gold || lineData.commodities.oil) {
    if (lineData.commodities.gold) {
      lines.push(`• 黃金：$${lineData.commodities.gold.toLocaleString()}/oz`);
    }
    if (lineData.commodities.oil) {
      lines.push(`• 原油：$${lineData.commodities.oil.toLocaleString()}/barrel`);
    }
  }
  
  // VIX
  if (lineData.vix) {
    lines.push(`• VIX 恐慌指數：${lineData.vix}`);
  }
  
  lines.push('');
  
  // 🔍 市場狀態（RULE 3: Market Regime）
  if (marketRegime) {
    lines.push('🔍 市場狀態');
    lines.push('');
    lines.push(`• ${marketRegime}`);
    lines.push('');
  }
  
  // 🌐 重點新聞區塊
  if (lineNews.length > 0) {
    lines.push('🌐 重點事件');
    lines.push('');
    
    // 只取前 10 條
    lineNews.slice(0, 10).forEach(news => {
      lines.push(`• ${news}`);
    });
    
    lines.push('');
  }
  
  // 🇹🇼 台灣焦點（來自 Market Digest）
  if (marketDigest?.narrative_states?.taiwan_focus) {
    lines.push('🇹🇼 台灣焦點');
    lines.push('');
    lines.push(`• ${marketDigest.narrative_states.taiwan_focus}`);
    lines.push('');
  }
  
  // 補充 Market Digest 的新聞（只列 LINE 沒提到的）
  if (marketDigest?.normalized_market_summary) {
    const mdNews = marketDigest.normalized_market_summary.filter(item => 
      !item.includes('TAIEX') && !item.includes('S&P') && !item.includes('USD')
    );
    
    const uniqueMdNews = deduplicateNews(mdNews, lineNews);
    
    if (uniqueMdNews.length > 0) {
      lines.push('📊 補充資訊');
      lines.push('');
      uniqueMdNews.slice(0, 5).forEach(news => {
        lines.push(`• ${news}`);
      });
      lines.push('');
    }
  }
  
  // 免責聲明
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  lines.push('📡 數據來源：LINE 群組 + TWSE + Yahoo Finance + Bloomberg');
  
  return lines.join('\n');
}

/**
 * 智慧整合並推播
 */
async function integrateAndPush() {
  try {
    const report = await smartIntegrate();
    
    // 推播到 Telegram
    console.log('📤 推播中...');
    
    // 因為報告可能包含特殊字元，先寫到檔案再推播
    const tempFile = '/tmp/morning-report.txt';
    fs.writeFileSync(tempFile, report);
    
    const result = execSync(
      `clawdbot message send --channel telegram --target 1377531222 --message "$(cat ${tempFile})"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    
    console.log('✅ 推播成功');
    return report;
    
  } catch (err) {
    console.error(`❌ 整合或推播失敗：${err.message}`);
    throw err;
  }
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2] || 'integrate';
  
  if (command === 'integrate') {
    smartIntegrate().catch(err => {
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
Smart Integrator - 智慧整合器（方案 B）

指令：
  integrate   生成整合報告（不推播）
  push        生成並推播到 Telegram
    `);
  }
}

module.exports = { smartIntegrate, integrateAndPush };
