#!/usr/bin/env node
// 使用 shared 層
const { createLogger } = require("./shared/logger");
const Deduplicator = require("./shared/deduplicator");

const logger = createLogger("smart-integrator");
const deduplicator = new Deduplicator({ algorithm: "keywords", keywordOverlapMin: 3 });
// Smart Integrator - 智慧整合 LINE 群組早報 + Market Digest
// 方案 B：提取關鍵資訊、去重、統一格式

// 忽略 EPIPE 錯誤（當 stdout 管道提前關閉時）
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    process.exit(0); // 正常退出，忽略管道關閉錯誤
  }
  throw err;
});

// 全局錯誤處理器 - SRE 版本
const errorHandler = require('./global-error-handler');
errorHandler.install({
  appName: 'smart-integrator',
  logDir: require('path').join(__dirname, 'logs'),
  maxErrorRate: 10
});

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const collector = require('./morning-collector');
const MarketDataFetcher = require('./backend/fetcher');
const RuntimeInputGenerator = require('./backend/runtime-gen');
const { applyResearchSignalPatch } = require('./research-signal-upgrade-patch');
const TimeSeriesStorage = require('./backend/timeseries-storage');
const { loadWatchlist, generateSummary, formatSummary } = require('./watchlist');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// 安全讀取 config.json
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  logger.error(`❌ 無法讀取設定檔 (${CONFIG_PATH}): ${err.message}`);
  process.exit(1);
}

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
  const twMatch = text.match(/(?:台股|加權指數).*?(?:收盤報?|[：:])\s*([0-9,]+(?:\.[0-9]+)?)\s*(?:點)?.*?(?:收)?(漲|跌|升|降|[-+])\s*([0-9,]+(?:\.[0-9]+)?)/i);
  if (twMatch) {
    const direction = twMatch[2];
    const changeValue = parseFloat(twMatch[3].replace(/,/g, ''));
    const isNegative = direction.includes('跌') || direction.includes('降') || direction.includes('-');
    
    data.tw_stock = {
      index: parseFloat(twMatch[1].replace(/,/g, '')),
      change: isNegative ? -changeValue : changeValue
    };
  }
  
  // 成交量
  const volMatch = text.match(/成交(?:金|值)?(?:額)?[：:]\s*([0-9,]+(?:\.[0-9]+)?)\s*億/i);
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
  
/**
 * 新聞去重（使用統一 Deduplicator）
 */
function deduplicateNews(lineNews, marketDigestNews) {
  const result = deduplicator.deduplicate(lineNews, marketDigestNews);
  return result.unique;
}

/**
 * 舊版新聞去重（已廢棄，保留以供參考）
 */
  return [...new Set(news)]; // 去重
}

/**
 * 新聞去重（與 Market Digest 比較）
 */
function deduplicateNews_OLD(lineNews, marketDigestNews) {
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
 * @param {string} level - 輸出級別：'minimal' | 'standard' | 'full'
 */
async function smartIntegrate(level = 'minimal') {
  logger.info(`🔄 開始智慧整合（級別：${level}）...`);
  
  // 1. 讀取 LINE 早報
  const collected = collector.getToday();
  const allText = collected.messages.map(m => m.content).join('\n\n');
  
  // 2. 提取 LINE 早報的關鍵資訊
  const lineMarketData = extractMarketData(allText);
  const lineNews = extractNews(allText);
  
  logger.info(`📝 LINE 早報：${collected.messages.length} 則，提取 ${lineNews.length} 條新聞`);
  
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
    logger.error(`⚠️  Market Digest 生成失敗：${err.message}`);
  }
  
  // 4. 新聞去重
  const uniqueLineNews = deduplicateNews(lineNews, marketNews);
  logger.info(`🔍 去重後 LINE 新聞：${uniqueLineNews.length} 條`);
  
  // 4.5. 套用 RESEARCH_SIGNAL_UPGRADE_PATCH
  const patchResult = applyResearchSignalPatch(uniqueLineNews);
  const finalNews = patchResult.primarySignals; // Top 3 signals
  const marketRegime = patchResult.regimeSentence; // Driver + Market Behavior
  const secondaryContext = patchResult.secondaryContext; // 補充訊號
  
  // 5. 生成整合報告（支援分級輸出）
  const reportData = {
    lineMarketData,
    finalNews,
    marketDigest,
    marketRegime,
    secondaryContext,
    allText,
    uniqueLineNews
  };
  
  const report = generateIntegratedReport(reportData, level);
  
  // 6. 儲存報告
  const outputPath = path.join(__dirname, 'data/runtime/morning-report.txt');
  fs.writeFileSync(outputPath, report);
  
  // 7. 儲存到時間序列資料庫
  try {
    const timeseriesStorage = new TimeSeriesStorage();
    const today = new Date().toISOString().split('T')[0];
    
    await timeseriesStorage.saveReport(today, report, {
      lineMessages: collected.messages.length,
      lineNews: uniqueLineNews.length,
      marketDigest: marketDigest ? true : false,
      regime: marketRegime,
      level: level
    });
    
    logger.info('💾 報告已儲存到時間序列資料庫');
  } catch (err) {
    logger.error('⚠️  時間序列報告儲存失敗:', err.message);
  }
  
  logger.info(`✅ 智慧整合完成（${level}）：${outputPath}`);
  logger.info(`📏 長度：${report.length} 字元`);
  
  return report;
}

/**
 * 生成整合報告（統一格式，支援分級輸出）
 * @param {Object} data - 報告數據
 * @param {string} level - 'minimal' | 'standard' | 'full'
 */
function generateIntegratedReport(data, level = 'minimal') {
  const { lineMarketData, finalNews, marketDigest, marketRegime, secondaryContext, allText, uniqueLineNews } = data;
  
  // 根據級別選擇生成方式
  if (level === 'minimal') {
    return generateMinimalReport(data);
  } else if (level === 'standard') {
    return generateStandardReport(data);
  } else if (level === 'full') {
    return generateFullReport(data);
  } else {
    throw new Error(`未知的輸出級別：${level}`);
  }
}

/**
 * 極簡版報告（200 字，推播用）
 */
function generateMinimalReport(data) {
  const { lineMarketData, finalNews, marketDigest, marketRegime } = data;
  const lines = [];
  
  // 標題
  const now = new Date();
  const dateStr = now.toLocaleString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const timeStr = now.toLocaleTimeString('zh-TW', { 
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  lines.push(`🌅 ${dateStr} ${timeStr}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  
  // 市場數據（單行）
  const marketLine = [];
  if (lineMarketData.tw_stock) {
    const tw = lineMarketData.tw_stock;
    const sign = tw.change >= 0 ? '▲' : '▼';
    const pct = marketDigest?.verified_key_data?.tw_stock?.taiex_change_pct || 'N/A';
    marketLine.push(`台股 ${sign}${pct}%`);
  }
  if (lineMarketData.us_stock.sp500 || marketDigest?.verified_key_data?.us_stock) {
    const usPct = marketDigest?.verified_key_data?.us_stock?.sp500_change_pct || 'N/A';
    const sign = usPct >= 0 ? '▲' : '▼';
    marketLine.push(`美股 ${sign}${usPct}%`);
  }
  lines.push(`📈 ${marketLine.join(' | ')}`);
  
  // 市場狀態
  if (marketRegime) {
    lines.push(`🔍 ${marketRegime}`);
  }
  
  // 焦點（前 3 條）
  if (finalNews && finalNews.length > 0) {
    lines.push('');
    lines.push('🌐 焦點：');
    finalNews.slice(0, 3).forEach(news => {
      // 縮短新聞到 40 字
      const short = news.length > 40 ? news.substring(0, 40) + '...' : news;
      lines.push(`  • ${short}`);
    });
  }
  
  // 提示
  lines.push('');
  lines.push('💬 輸入 /today 查看完整版');
  lines.push('━━━━━━━━━━━━━━━━━━');
  
  return lines.join('\n');
}

/**
 * 標準版報告（800 字，詳細但不冗長）
 */
function generateStandardReport(data) {
  const { lineMarketData, finalNews, marketDigest, marketRegime, secondaryContext } = data;
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
  
  // 台股
  if (lineMarketData.tw_stock) {
    const tw = lineMarketData.tw_stock;
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
  
  // 技術指標
  if (marketDigest?.verified_key_data?.tw_stock?.ma5) {
    const tw = marketDigest.verified_key_data.tw_stock;
    lines.push(`  技術指標：MA5 ${tw.ma5} | MA20 ${tw.ma20} | RSI ${tw.rsi}`);
  }
  
  // 美股
  if (lineMarketData.us_stock.sp500) {
    lines.push(`• S&P 500：${lineMarketData.us_stock.sp500.toLocaleString()}`);
  } else if (marketDigest?.verified_key_data?.us_stock) {
    const us = marketDigest.verified_key_data.us_stock;
    lines.push(`• S&P 500：${us.sp500_close?.toLocaleString() || 'N/A'} (${us.sp500_change_pct >= 0 ? '+' : ''}${us.sp500_change_pct}%)`);
  }
  
  // 匯率
  if (lineMarketData.fx.usdtwd) {
    lines.push(`• 台幣：${lineMarketData.fx.usdtwd}`);
  } else if (marketDigest?.verified_key_data?.fx) {
    const fx = marketDigest.verified_key_data.fx;
    const sign = fx.usdtwd_change_pct >= 0 ? '貶' : '升';
    lines.push(`• 台幣：${fx.usdtwd} (${sign}${Math.abs(fx.usdtwd_change_pct)}%)`);
  }
  
  lines.push('');
  
  // 市場狀態
  if (marketRegime) {
    lines.push('🔍 市場狀態');
    lines.push('');
    lines.push(`• ${marketRegime}`);
    lines.push('');
  }
  
  // 重點事件
  if (finalNews && finalNews.length > 0) {
    lines.push('🌐 重點事件');
    lines.push('');
    finalNews.slice(0, 8).forEach(news => {
      lines.push(`• ${news}`);
    });
    lines.push('');
  }
  
  // 補充訊號
  if (secondaryContext && secondaryContext.length > 0) {
    lines.push('🔵 補充訊號');
    lines.push('');
    secondaryContext.slice(0, 3).forEach(ctx => {
      lines.push(`• ${ctx}`);
    });
    lines.push('');
  }
  
  // 台灣焦點
  if (marketDigest?.narrative_states?.taiwan_focus) {
    lines.push('🇹🇼 台灣焦點');
    lines.push('');
    lines.push(`• ${marketDigest.narrative_states.taiwan_focus}`);
    lines.push('');
  }
  
  // 我的關注股（Watchlist）
  try {
    const watchlist = loadWatchlist();
    if (watchlist.stocks && watchlist.stocks.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      const summary = generateSummary(today);
      
      if (summary && summary.stocks.length > 0) {
        lines.push(`📌 我的關注股（${summary.stocks.length} 檔有消息）`);
        lines.push('');
        
        summary.stocks.slice(0, 5).forEach(stock => {
          const emoji = stock.mentions > 2 ? '🔥' : stock.mentions > 1 ? '⭐' : '📊';
          lines.push(`${emoji} ${stock.code} ${stock.name} (${stock.mentions} 次提及)`);
          
          // 只顯示第一個上下文（簡化版）
          if (stock.contexts && stock.contexts.length > 0) {
            let text = stock.contexts[0].context;
            if (text.length > 100) {
              text = text.substring(0, 100) + '...';
            }
            lines.push(`  • ${text}`);
          }
          lines.push('');
        });
      }
    }
  } catch (err) {
    // Watchlist 錯誤不影響整體報告
    logger.error('⚠️  Watchlist 處理失敗:', err.message);
  }
  
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  lines.push('💬 輸入 /today full 查看原始早報全文');
  
  return lines.join('\n');
}

/**
 * 完整版報告（保留原始早報全文）
 */
function generateFullReport(data) {
  const { allText } = data;
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
  
  lines.push('📰 原始早報全文');
  lines.push(`📅 ${dateStr} ${timeStr}`);
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(allText);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━');
  lines.push('⚠️ 免責聲明：本報告僅供資訊參考，不構成投資建議');
  lines.push('📡 數據來源：LINE 群組早報（原文）');
  
  return lines.join('\n');
}

/**
 * 智慧整合並推播
 * @param {string} level - 輸出級別：'minimal' | 'standard' | 'full'
 */
async function integrateAndPush(level = 'minimal') {
  try {
    const report = await smartIntegrate(level);
    
    // 推播到 Telegram
    logger.info(`📤 推播中（級別：${level}）...`);
    
    // 因為報告可能包含特殊字元，先寫到檔案再推播
    const tempFile = '/tmp/morning-report.txt';
    fs.writeFileSync(tempFile, report);
    
    const result = execSync(
      `/home/clawbot/.nvm/versions/node/v22.22.0/bin/clawdbot message send --channel telegram --target REDACTED_CHAT_ID --message "$(cat ${tempFile})"`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000, // 30 秒超時
        env: {
          ...process.env,
          PATH: `/home/clawbot/.nvm/versions/node/v22.22.0/bin:${process.env.PATH || ''}`
        }
      }
    );
    
    logger.info('✅ 推播成功');
    return report;
    
  } catch (err) {
    logger.error(`❌ 整合或推播失敗：${err.message}`);
    
    // 如果是 timeout，提供建議
    if (err.code === 'ETIMEDOUT' || err.killed) {
      logger.error('⚠️  推播超時（30秒），可能是：');
      logger.error('   1. Telegram API 回應緩慢');
      logger.error('   2. 報告內容過長');
      logger.error('   3. 網路連線問題');
      logger.error('   建議：檢查報告長度或稍後重試');
    }
    
    throw err;
  }
}

// CLI 模式
if (require.main === module) {
  const command = process.argv[2] || 'integrate';
  
  // 解析 --level 參數
  const levelIndex = process.argv.indexOf('--level');
  const level = levelIndex !== -1 && process.argv[levelIndex + 1] 
    ? process.argv[levelIndex + 1] 
    : 'minimal';
  
  if (command === 'integrate') {
    smartIntegrate(level).catch(err => {
      logger.error(err);
      process.exit(1);
    });
  } else if (command === 'push') {
    integrateAndPush(level).catch(err => {
      logger.error(err);
      process.exit(1);
    });
  } else {
    logger.info(`
Smart Integrator - 智慧整合器（方案 B）

指令：
  integrate [--level <minimal|standard|full>]   生成整合報告（不推播）
  push [--level <minimal|standard|full>]        生成並推播到 Telegram

級別說明：
  minimal   極簡版（200 字，推播用）- 預設
  standard  標準版（800 字，詳細但不冗長）
  full      完整版（原始早報全文）

範例：
  node smart-integrator.js integrate --level standard
  node smart-integrator.js push --level minimal
    `);
  }
}

module.exports = { smartIntegrate, integrateAndPush };
