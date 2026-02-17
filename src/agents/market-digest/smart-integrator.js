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
const { loadWatchlist, generateSummary, formatSummary, generateSummaryWithFinancial } = require('./watchlist');
const costLedger = require('./backend/cost-ledger');

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

  return [...new Set(news)]; // 去重
}

/**
 * 新聞去重（使用統一 Deduplicator）
 */
function deduplicateNews(lineNews, marketDigestNews) {
  const result = deduplicator.deduplicate(lineNews, marketDigestNews);
  return result.unique;
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
 * 載入 AI 分析新聞 (方案 1: 暗數據解鎖)
 * 從 data/news-analyzed/{date}.json 提取 Top N 高分新聞
 * @param {string} date - YYYY-MM-DD 格式日期
 * @param {number} topN - 取前 N 則新聞
 */
function loadAIAnalyzedNews(date, topN = 5) {
  try {
    const filePath = path.join(__dirname, 'data', 'news-analyzed', `${date}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.news || !Array.isArray(data.news)) {
      return null;
    }
    const withAnalysis = data.news.filter(item => item.analysis && item.analysis.importance);
    const sorted = [...withAnalysis].sort((a, b) => b.analysis.importance - a.analysis.importance);
    const highScore = withAnalysis.filter(n => n.analysis.importance >= 7).length;

    return {
      total: data.count || data.news.length,
      highScore,
      top: sorted.slice(0, topN)
    };
  } catch (err) {
    logger.error(`⚠️  AI 分析新聞載入失敗: ${err.message}`);
    return null;
  }
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
  
  // 2.5. === 四步 Pipeline: News Fetch + Market Enrich ===
  let pipelineData = null;
  try {
    const fetcher = new MarketDataFetcher(config);
    pipelineData = await fetcher.fetchPipeline();

    const pxCount = pipelineData.news.perplexity.length;
    const fmpKeys = Object.keys(pipelineData.market.fmp.quotes || {}).length;
    const fmMovers = (pipelineData.market.finmind.topMovers || []).length;
    logger.info(`🔗 Pipeline 完成：Perplexity ${pxCount} 則 | FMP ${fmpKeys} 支美股 | FinMind 前 ${fmMovers} 異動股`);
    if (pipelineData.errors.length > 0) {
      pipelineData.errors.forEach(e => logger.warn(`⚠️  ${e.source}: ${e.error}`));
    }
  } catch (err) {
    logger.error(`⚠️  Pipeline 失敗（降級為既有資料源）: ${err.message}`);
  }

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

  // 3.5. 合併 Perplexity 新聞到去重池
  if (pipelineData && pipelineData.news.perplexity.length > 0) {
    const perplexityTitles = pipelineData.news.perplexity.map(n => n.title);
    marketNews = [...marketNews, ...perplexityTitles];
    logger.info(`📰 合併 Perplexity ${perplexityTitles.length} 則新聞到去重池`);
  }

  // 4. 新聞去重（含 Perplexity 來源）
  const allNewsTitles = [...lineNews];
  if (pipelineData && pipelineData.news.perplexity.length > 0) {
    pipelineData.news.perplexity.forEach(n => allNewsTitles.push(n.title));
  }
  const uniqueLineNews = deduplicateNews(allNewsTitles, marketNews);
  logger.info(`🔍 去重後新聞：${uniqueLineNews.length} 條（來源：LINE + Perplexity）`);
  
  // 4.5. 套用 RESEARCH_SIGNAL_UPGRADE_PATCH
  const patchResult = applyResearchSignalPatch(uniqueLineNews);
  const finalNews = patchResult.primarySignals; // Top 3 signals
  const marketRegime = patchResult.regimeSentence; // Driver + Market Behavior
  const secondaryContext = patchResult.secondaryContext; // 補充訊號
  
  // 5. 載入 AI 分析新聞（暗數據解鎖）
  const today = new Date().toISOString().split('T')[0];
  const aiNews = loadAIAnalyzedNews(today);
  if (aiNews) {
    logger.info(`📰 AI 分析新聞：${aiNews.total} 則 → ${aiNews.highScore} 則(≥7分) → 精選 ${aiNews.top.length} 則`);
  }

  // 5.5 載入持股雷達（方案 2）
  let watchlistRadar = null;
  try {
    watchlistRadar = await generateSummaryWithFinancial(today);
    if (watchlistRadar && watchlistRadar.stocks.length > 0) {
      logger.info(`🎯 持股雷達：${watchlistRadar.stocks.length} 檔股票分析完成`);
    }
  } catch (err) {
    logger.error(`⚠️  持股雷達載入失敗: ${err.message}`);
  }

  // 6. 生成整合報告（支援分級輸出）
  const reportData = {
    lineMarketData,
    finalNews,
    marketDigest,
    marketRegime,
    secondaryContext,
    allText,
    uniqueLineNews,
    aiNews,
    pipelineData,
    watchlistRadar
  };

  const report = generateIntegratedReport(reportData, level);

  // 7. 儲存報告
  const outputPath = path.join(__dirname, 'data/runtime/morning-report.txt');
  fs.writeFileSync(outputPath, report);

  // 8. 儲存到時間序列資料庫
  try {
    const timeseriesStorage = new TimeSeriesStorage();
    
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
  
  // AI 精選新聞（暗數據解鎖 - 極簡版）
  if (data.aiNews && data.aiNews.top.length > 0) {
    const topItem = data.aiNews.top[0];
    const title = topItem.title.length > 25 ? topItem.title.substring(0, 25) + '...' : topItem.title;
    lines.push('');
    lines.push(`📰 AI精選: ${title}(${topItem.analysis.importance}分)等${data.aiNews.top.length}則`);
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

  // Perplexity 研究重點（投資人視角）
  if (data.pipelineData && data.pipelineData.news.perplexity.length > 0) {
    lines.push('🔬 Perplexity 研究摘要');
    lines.push('');
    data.pipelineData.news.perplexity.slice(0, 5).forEach((news, i) => {
      const title = news.title.length > 60 ? news.title.substring(0, 60) + '...' : news.title;
      lines.push(`${i + 1}. ${title}`);
      if (news.description) {
        const desc = news.description.length > 80 ? news.description.substring(0, 80) + '...' : news.description;
        lines.push(`   ${desc}`);
      }
    });
    lines.push('');
  }

  // FMP 美股報價
  if (data.pipelineData && data.pipelineData.market.fmp.quotes) {
    const quotes = data.pipelineData.market.fmp.quotes;
    const symbols = Object.keys(quotes);
    if (symbols.length > 0) {
      lines.push('🇺🇸 美股即時報價（FMP）');
      lines.push('');
      symbols.forEach(sym => {
        const q = quotes[sym];
        const sign = q.changesPercentage >= 0 ? '▲' : '▼';
        const pct = Math.abs(q.changesPercentage || 0).toFixed(2);
        lines.push(`• ${sym}: $${q.price} ${sign}${pct}%`);
      });
      lines.push('');
    }

    // 本周財報日曆
    const earnings = data.pipelineData.market.fmp.earnings || [];
    if (earnings.length > 0) {
      lines.push('📅 本周財報日曆');
      lines.push('');
      earnings.slice(0, 5).forEach(e => {
        lines.push(`• ${e.date} ${e.symbol} (EPS 預估: ${e.epsEstimated || 'N/A'})`);
      });
      lines.push('');
    }
  }

  // FinMind 台股資料
  if (data.pipelineData && data.pipelineData.market.finmind) {
    const fm = data.pipelineData.market.finmind;

    // 加權指數
    if (fm.taiex) {
      lines.push('🇹🇼 台股加權指數（FinMind）');
      lines.push('');
      const sign = fm.taiex.change >= 0 ? '▲' : '▼';
      lines.push(`• TAIEX: ${fm.taiex.close} ${sign}${Math.abs(fm.taiex.change || 0)}`);
      lines.push('');
    }

    // 0050 成分股外資異動前 10
    if (fm.topMovers && fm.topMovers.length > 0) {
      lines.push('📊 0050 外資異動 Top 10');
      lines.push('');
      fm.topMovers.forEach((m, i) => {
        const netSign = m.foreignNetBuy >= 0 ? '買超' : '賣超';
        const net = Math.abs(m.foreignNetBuy / 1000).toFixed(0);
        const priceInfo = fm.tw50Prices && fm.tw50Prices[m.stockId]
          ? ` | ${fm.tw50Prices[m.stockId].close}元 (${fm.tw50Prices[m.stockId].changePct > 0 ? '+' : ''}${fm.tw50Prices[m.stockId].changePct}%)`
          : '';
        lines.push(`${i + 1}. ${m.stockId}${priceInfo} — 外資${netSign} ${net} 張`);
      });
      lines.push('');
    }
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
  
  // AI 精選新聞（暗數據解鎖）
  if (data.aiNews && data.aiNews.top.length > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('📰 AI 精選新聞 | Top 5');
    lines.push('');
    data.aiNews.top.forEach((item, i) => {
      const score = item.analysis.importance;
      const icon = score >= 10 ? '🔴' : score >= 8 ? '🟡' : '🟢';
      const title = item.title.length > 50 ? item.title.substring(0, 50) + '...' : item.title;
      lines.push(`${i + 1}. [${score}] ${icon} ${title}`);
      if (item.analysis.marketImplication) {
        const impl = item.analysis.marketImplication.length > 40
          ? item.analysis.marketImplication.substring(0, 40) + '...'
          : item.analysis.marketImplication;
        lines.push(`   影響：${impl}`);
      }
      if (item.analysis.tags && item.analysis.tags.length > 0) {
        lines.push(`   關聯：${item.analysis.tags.join(', ')}`);
      }
      if (item.analysis.inWatchlist) {
        lines.push(`   ⭐ Watchlist 關注股`);
      }
    });
    lines.push('');
    lines.push(`📊 今日分析 ${data.aiNews.total} 則 → 篩選 ${data.aiNews.highScore} 則(≥7分) → 精選 ${data.aiNews.top.length} 則`);
    lines.push('');
  }

  // 台灣焦點
  if (marketDigest?.narrative_states?.taiwan_focus) {
    lines.push('🇹🇼 台灣焦點');
    lines.push('');
    lines.push(`• ${marketDigest.narrative_states.taiwan_focus}`);
    lines.push('');
  }
  
  // 持股雷達（方案 2：暗數據 + 籌碼 + 財務整合）
  if (data.watchlistRadar && data.watchlistRadar.stocks && data.watchlistRadar.stocks.length > 0) {
    lines.push('━━━━━━━━━━━━━━━━━━');
    const dateStr = data.watchlistRadar.date || new Date().toISOString().split('T')[0];
    lines.push(`🎯 持股雷達 | ${dateStr}`);
    lines.push('');

    data.watchlistRadar.stocks.forEach((stock, i) => {
      const score = stock.analysis ? stock.analysis.score : 50;
      const recIcon = score >= 65 ? '🟢' : score <= 35 ? '🔴' : '➖';
      lines.push(`${i + 1}. ${stock.code} ${stock.name} [${recIcon} ${score}分]`);

      // 日交易資料
      if (stock.chip && stock.chip.stock) {
        const s = stock.chip.stock;
        const sign = s.change >= 0 ? '▲' : '▼';
        const vol = s.volume ? (s.volume / 1000).toFixed(0) : 'N/A';
        lines.push(`   💹 ${s.closingPrice} 元 (${sign}${Math.abs(s.change)}) | 量 ${vol} 張`);
      }

      // 三大法人
      if (stock.chip && stock.chip.institutional) {
        const inst = stock.chip.institutional;
        const fSign = inst.foreign >= 0 ? '買超' : '賣超';
        const fVal = Math.abs(inst.foreign / 1000).toFixed(0);
        const tSign = (inst.trust || inst.investment || 0) >= 0 ? '+' : '';
        const tVal = ((inst.trust || inst.investment || 0) / 1000).toFixed(0);
        lines.push(`   📌 外資${fSign} ${fVal} 張 | 投信${tSign}${tVal}`);
      }

      // 融資融券
      if (stock.chip && stock.chip.margin) {
        const m = stock.chip.margin;
        const parts = [];
        if (m.marginLimit && m.marginBalance) {
          const rate = (m.marginBalance / m.marginLimit * 100).toFixed(1);
          parts.push(`融資率 ${rate}%`);
        }
        if (m.shortBalancePrev && m.shortBalance) {
          const shortChg = m.shortBalance - m.shortBalancePrev;
          if (shortChg !== 0) {
            const shortSign = shortChg > 0 ? '▲' : '▼';
            parts.push(`融券${shortSign}${Math.abs(shortChg)}`);
          }
        }
        if (parts.length > 0) {
          lines.push(`   💰 ${parts.join(' | ')}`);
        }
      }

      // AI 新聞關聯（從 aiNews 中篩選 watchlist 相關）
      if (data.aiNews && data.aiNews.top.length > 0) {
        const related = data.aiNews.top.filter(n =>
          n.analysis && n.analysis.inWatchlist &&
          n.analysis.affectedAssets && n.analysis.affectedAssets.some(a => a.includes(stock.name))
        );
        if (related.length > 0) {
          const top = related[0];
          const title = top.title.length > 30 ? top.title.substring(0, 30) + '...' : top.title;
          lines.push(`   📰 ${title} (${top.analysis.importance}分)`);
        }
      }

      // 月營收
      if (stock.financial && stock.financial.monthlyRevenue) {
        const rev = stock.financial.monthlyRevenue;
        if (rev.revenue) {
          const revBillion = (rev.revenue / 100000000).toFixed(0);
          const yoy = rev.yoyGrowth ? `YoY${rev.yoyGrowth >= 0 ? '+' : ''}${rev.yoyGrowth.toFixed(0)}%` : '';
          lines.push(`   📈 月營收 ${revBillion} 億 ${yoy}`);
        }
      }

      // 籌碼面建議
      if (stock.analysis && stock.analysis.recommendation !== 'neutral') {
        lines.push(`   ▶ ${stock.analysis.recommendationMessage}`);
      }
    });

    lines.push('');
  } else {
    // 回退：簡易版關注股（無籌碼資料時）
    try {
      const watchlist = loadWatchlist();
      if (watchlist.stocks && watchlist.stocks.length > 0) {
        const todayDate = new Date().toISOString().split('T')[0];
        const summary = generateSummary(todayDate);
        if (summary && summary.stocks.length > 0) {
          lines.push(`📌 我的關注股（${summary.stocks.length} 檔有消息）`);
          lines.push('');
          summary.stocks.slice(0, 5).forEach(stock => {
            const emoji = stock.mentions > 2 ? '🔥' : stock.mentions > 1 ? '⭐' : '📊';
            lines.push(`${emoji} ${stock.code} ${stock.name} (${stock.mentions} 次提及)`);
            if (stock.contexts && stock.contexts.length > 0) {
              let text = stock.contexts[0].context;
              if (text.length > 100) text = text.substring(0, 100) + '...';
              lines.push(`  • ${text}`);
            }
          });
          lines.push('');
        }
      }
    } catch (err) {
      logger.error('⚠️  Watchlist 處理失敗:', err.message);
    }
  }
  
  // 成本摘要
  if (data.pipelineData && data.pipelineData.costSummary) {
    lines.push(data.pipelineData.costSummary);
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
