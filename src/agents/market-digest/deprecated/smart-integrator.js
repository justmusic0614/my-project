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
const TwoStageSummarizer = require('./backend/two-stage-summarize');
const { renderUnifiedMorningReport } = require('./institutional-renderer');

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
 * 生成分析區塊（從 DailyBriefGenerator 邏輯整合）
 * 直接接收 smartIntegrate 已獲取的資料，不重複呼叫 API
 */
async function generateAnalyticalSections(analyzedNews, lineMarketData, marketDigest, pipelineData) {
  // 建構統一市場數據物件
  const md = buildMarketDataFromPipeline(lineMarketData, marketDigest, pipelineData);

  return {
    marketRegime: generateRegimeSection(analyzedNews, md),
    macroPolicy: generateMacroPolicySection(analyzedNews, md),
    crossAsset: generateCrossAssetSection(analyzedNews, md),
    taiwanMarket: generateTaiwanMarketSection(analyzedNews, md, lineMarketData),
    eventCalendar: generateEventCalendarSection(analyzedNews, pipelineData)
  };
}

/**
 * 從已有資料建構統一市場數據（避免重複 API 呼叫）
 */
function buildMarketDataFromPipeline(lineMarketData, marketDigest, pipelineData) {
  const vkd = marketDigest?.verified_key_data || {};
  const fmpQuotes = pipelineData?.market?.fmp?.quotes || {};
  const finmind = pipelineData?.market?.finmind || {};

  return {
    twii: {
      value: vkd.tw_stock?.taiex_close || lineMarketData.tw_stock?.index || 0,
      change: vkd.tw_stock?.taiex_change_pct || 0
    },
    sp500: {
      value: vkd.us_stock?.sp500_close || lineMarketData.us_stock?.sp500 || 0,
      change: vkd.us_stock?.sp500_change_pct || 0
    },
    usd_twd: {
      value: vkd.fx?.usdtwd || lineMarketData.fx?.usdtwd || 0,
      change: vkd.fx?.usdtwd_change_pct || 0
    },
    vix: { value: lineMarketData.vix || 0, change: 0 },
    dxy: { value: lineMarketData.fx?.dxy || 0, change: 0 },
    us10y: { value: 0, change: 0 },
    volume: lineMarketData.tw_stock?.volume || null,
    finmind,
    fmpQuotes
  };
}

function generateRegimeSection(news, md) {
  let state = 'Risk-on 與 Risk-off 並存';
  if (md.vix.value > 20) {
    state = 'Risk-off 情緒升溫，市場避險需求增加';
  } else if (md.vix.value > 0 && md.vix.value < 15) {
    state = 'Risk-on 主導，市場風險偏好回升';
  }

  let flow = '資金輪動加速，追逐題材明確標的';
  if (md.twii.change > 0 && md.sp500.change > 0) {
    flow = '全球股市同步走強，資金偏好風險資產';
  } else if (md.twii.change < 0 && md.sp500.change < 0) {
    flow = '全球股市同步走弱，資金轉向防禦';
  }

  const hasHighImportance = news.some(n => n.analysis && n.analysis.importance >= 9);
  let implication = '選股不選市，聚焦基本面';
  if (hasHighImportance) {
    implication = '重大事件主導，短期波動加劇';
  } else if (Math.abs(md.twii.change) > 2) {
    implication = '高檔震盪，波段操作為主';
  }

  return { state, flow, implication };
}

function generateMacroPolicySection(news, md) {
  const macroNews = news.filter(n => n.analysis && n.analysis.category === '總經');
  const us10yStr = md.us10y.value ? `${md.us10y.value.toFixed(2)}%` : 'N/A';
  const dxyStr = md.dxy.value ? `${md.dxy.value.toFixed(1)}` : 'N/A';
  const vixStr = md.vix.value ? `${md.vix.value.toFixed(1)}` : 'N/A';

  return {
    keyData: { us10y: us10yStr, dxy: dxyStr, vix: vixStr },
    focus: macroNews.slice(0, 3).map(n => n.title),
    implication: macroNews.length > 0 && macroNews[0].analysis
      ? macroNews[0].analysis.marketImplication
      : '政策面平穩'
  };
}

function generateCrossAssetSection(news, md) {
  return {
    commodities: {
      oil: '持平',
      gold: md.vix.value > 20 ? '避險需求升溫' : '持穩',
      copper: 'AI 基建需求'
    },
    fxRates: {
      usd: md.dxy.change < 0 ? '偏弱' : (md.dxy.value ? '偏強' : 'N/A'),
      us10y: md.us10y.change < 0 ? '回落' : (md.us10y.value ? '上行' : 'N/A'),
      twd: md.usd_twd.value ? `USD/TWD ${md.usd_twd.value.toFixed ? md.usd_twd.value.toFixed(2) : md.usd_twd.value}` : 'N/A'
    },
    implication: md.dxy.change < 0 ? '降息預期推升風險資產' : '美元強勢壓抑風險偏好'
  };
}

function generateTaiwanMarketSection(news, md, lineMarketData) {
  const twNews = news.filter(n => n.analysis && n.analysis.category === '台股');
  const changePct = md.twii.change;
  const sign = changePct >= 0 ? '▲' : '▼';

  const index = md.twii.value
    ? `加權指數 ${Math.round(md.twii.value).toLocaleString()} ${sign}${Math.abs(changePct).toFixed(2)}%`
    : '加權指數 N/A';

  const volume = md.volume ? `成交量 ${md.volume} 億` : '成交量 N/A';

  // 外資動向（從 FinMind 資料取得）
  let foreign = '外資 N/A';
  if (md.finmind && md.finmind.topMovers && md.finmind.topMovers.length > 0) {
    const totalNet = md.finmind.topMovers.reduce((sum, m) => sum + (m.foreignNetBuy || 0), 0);
    const netSign = totalNet >= 0 ? '買超' : '賣超';
    foreign = `外資${netSign} ${Math.abs(totalNet / 1000).toFixed(0)} 張（0050 成分股）`;
  }

  return {
    index,
    volume,
    foreign,
    trend: twNews.length > 0 ? twNews[0].title : null,
    implication: Math.abs(changePct) > 1 ? '高檔震盪，選股重於選市' : '盤整格局，等待方向'
  };
}

function generateEventCalendarSection(news, pipelineData) {
  const events = [];

  // 從 FMP 財報日曆取得
  if (pipelineData && pipelineData.market.fmp.earnings) {
    pipelineData.market.fmp.earnings.slice(0, 3).forEach(e => {
      events.push(`${e.date} ${e.symbol} 財報 (EPS 預估: ${e.epsEstimated || 'N/A'})`);
    });
  }

  // 從新聞中提取事件
  const eventNews = (news || []).filter(n =>
    n.title && (n.title.includes('法說會') || n.title.includes('財報') || n.title.includes('數據'))
  );
  eventNews.slice(0, 2).forEach(n => {
    if (!events.some(e => e.includes(n.title.substring(0, 10)))) {
      events.push(n.title.length > 40 ? n.title.substring(0, 40) + '...' : n.title);
    }
  });

  return events;
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

  // 5.75. Two-Stage Summarize（Haiku → Sonnet 三版摘要）
  let twoStageSummary = null;
  try {
    const summarizer = new TwoStageSummarizer(config.twoStageSummarize || {});
    // 合併所有新聞供摘要使用
    const allNewsForSummary = [...uniqueLineNews];
    if (pipelineData && pipelineData.news.perplexity.length > 0) {
      pipelineData.news.perplexity.forEach(n => {
        if (!allNewsForSummary.includes(n.title)) allNewsForSummary.push(n.title);
      });
    }
    if (allNewsForSummary.length > 0) {
      twoStageSummary = await summarizer.summarize(allNewsForSummary, pipelineData || {});
      if (!twoStageSummary.skipped) {
        logger.info(`✅ Two-Stage Summarize 完成（30秒版 ${twoStageSummary.brief30s?.length || 0} 字）`);
      } else {
        logger.info(`⚠️  Two-Stage Summarize 跳過：${twoStageSummary.reason}`);
      }
    }
  } catch (err) {
    logger.error(`⚠️  Two-Stage Summarize 失敗: ${err.message}`);
  }

  // 5.8. 生成分析區塊（從 DailyBriefGenerator 邏輯整合）
  let analyticalSections = null;
  try {
    analyticalSections = await generateAnalyticalSections(
      aiNews ? aiNews.top : [],
      lineMarketData,
      marketDigest,
      pipelineData
    );
    if (analyticalSections) {
      logger.info('📊 分析區塊生成完成');
    }
  } catch (err) {
    logger.error(`⚠️  分析區塊生成失敗（降級為純 smart-integrator 輸出）: ${err.message}`);
  }

  // 6. 生成整合報告（統一渲染引擎）
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
    watchlistRadar,
    twoStageSummary,
    analyticalSections
  };

  const report = renderUnifiedMorningReport(reportData, level);

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

// === 舊渲染函式已移至 institutional-renderer.js 的 renderUnifiedMorningReport() ===

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
      `/home/clawbot/.nvm/versions/node/v22.22.0/bin/clawdbot message send --channel telegram --target ${process.env.TELEGRAM_CHAT_ID} --message "$(cat ${tempFile})"`,
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
