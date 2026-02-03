// Runtime Input Generator
// 將原始數據 + 處理結果 → 標準化 runtime input

// 全局錯誤處理器（如果作為獨立進程運行）
if (require.main === module) {
  const errorHandler = require('../global-error-handler');
  errorHandler.install({
    appName: 'runtime-gen',
    logDir: require('path').join(__dirname, '../logs'),
    maxErrorRate: 10
  });
}

const MarketDataFetcher = require('./fetcher');
const NewsProcessor = require('./processor');
const AITranslator = require('./ai-translator');
const ContentFilter = require('./content-filter');
const BulletFormatter = require('./bullet-formatter');
const RiskRadarGenerator = require('./risk-radar');
const SectionRouter = require('./section-router');
const EnglishCleaner = require('./english-cleaner');
const QuotaManager = require('./quota-manager');
const BulletGuard = require('./bullet-guard');
const idempotencyCache = require('./idempotency');
const { applyResearchSignalPatch } = require('../research-signal-upgrade-patch');
const TimeSeriesStorage = require('./timeseries-storage');
const fs = require('fs');
const path = require('path');

class RuntimeInputGenerator {
  constructor(config) {
    this.config = config;
    this.fetcher = new MarketDataFetcher(config);
    this.processor = new NewsProcessor(config);
    this.translator = new AITranslator();
    this.contentFilter = new ContentFilter();
    this.bulletFormatter = new BulletFormatter();
    this.riskRadar = new RiskRadarGenerator();
    this.sectionRouter = new SectionRouter();
    this.englishCleaner = new EnglishCleaner();
    this.quotaManager = new QuotaManager(config);
    this.bulletGuard = new BulletGuard();
    this.timeseriesStorage = new TimeSeriesStorage();
  }

  async generate() {
    console.log('🔄 開始生成 Runtime Input...\n');

    // 0. IDEMPOTENCY v0 检查
    const today = new Date().toISOString().split('T')[0];
    const cacheFile = path.join(__dirname, '../data/cache/news-raw.json');
    const cachedNews = this.fetcher.loadCache(cacheFile);
    
    if (cachedNews.length > 0) {
      const lastItemTs = new Date(cachedNews[cachedNews.length - 1].pubDate).getTime();
      const cached = idempotencyCache.get(today, cachedNews.length, lastItemTs);
      
      if (cached) {
        console.log('✅ 使用缓存报告（30分钟内未变）\n');
        return cached;
      }
    }

    // 1. 抓取市場數據
    console.log('📊 抓取市場數據...');
    const marketData = await this.fetcher.fetchMarketData();
    
    // 2. 取得最近新聞
    console.log('📰 讀取快取新聞...');
    const recentNews = this.fetcher.getRecentNews(this.config.processing.max_age_hours);
    
    // 3. 翻譯英文標題
    console.log('🌐 翻譯英文新聞...');
    const translatedNews = recentNews.map(article => {
      if (this.translator.needsTranslation(article.title)) {
        return {
          ...article,
          title_original: article.title,
          title: this.translator.translateTitle(article.title)
        };
      }
      return article;
    });
    
    // 4. 英文殘留清理（15% gate）
    console.log('🧹 清理英文殘留...');
    const cleanedNews = this.englishCleaner.cleanBatch(translatedNews);
    
    // 5. 過濾非制度化內容
    console.log('🔍 過濾非制度化內容...');
    const institutionalNews = this.contentFilter.filterArticles(cleanedNews);
    
    // 6. 去重
    const uniqueNews = this.processor.deduplicateByTitle(institutionalNews);
    
    // 7. 標準化與排序
    const normalizedNews = this.processor.normalizeNews(
      uniqueNews,
      marketData,
      this.config.telegram.full_report_items
    );
    
    // 8. Event 去重：每個事件只出現一次
    const dedupedEvents = this.deduplicateEvents(normalizedNews);
    
    // 9. Section routing
    console.log('📂 分配 sections...');
    let routedSections = this.sectionRouter.routeBatch(dedupedEvents);
    
    // 10. MINIMUM QUOTA + BACKFILL
    routedSections = this.quotaManager.ensureMinimumQuota(routedSections, uniqueNews);
    routedSections = this.quotaManager.enforceMaxQuota(routedSections);
    
    // 11. 生成 Fact-driven bullets（按 section）
    let sectionBullets = {};
    Object.entries(routedSections).forEach(([section, articles]) => {
      sectionBullets[section] = articles.map(article => 
        this.bulletFormatter.formatBullet(article)
      );
    });
    
    // 12. POST_RENDER_BULLET_GUARD（确定性，无 LLM）
    console.log('🛡️  应用 Bullet Guard...');
    sectionBullets = this.bulletGuard.guardBatch(sectionBullets);
    
    // 11. 判斷整體重要性
    const overallImportance = this.processor.assessOverallImportance(normalizedNews);
    
    // 12. 計算整體 Confidence Level
    const overallConfidence = this.assessOverallConfidence(marketData);
    
    // 13. 建構 verified_key_data
    const verifiedKeyData = this.buildVerifiedKeyData(marketData);
    
    // 14. 建構 narrative_states
    const narrativeStates = this.buildNarrativeStates(normalizedNews, marketData);
    
    // 15. 建構 health_components
    const healthComponents = this.buildHealthComponents(normalizedNews, marketData);
    
    // 16. Risk Radar（CRITICAL 等級必須輸出）
    let riskRadar = null;
    if (overallImportance === 'CRITICAL') {
      const criticalNews = normalizedNews.filter(n => n.importance === 'CRITICAL');
      riskRadar = this.riskRadar.generate(criticalNews, marketData);
    }
    
    // 16.5. RESEARCH_SIGNAL_UPGRADE_PATCH
    console.log('🔬 應用 Research Signal Patch...');
    const allEventTitles = normalizedNews.map(n => n.title);
    const signalPatch = applyResearchSignalPatch(allEventTitles);
    
    // 17. 組合 runtime input
    const runtimeInput = {
      report_metadata: {
        generated_at: new Date().toISOString(),
        timezone: 'Asia/Taipei',
        importance_level: overallImportance,
        confidence_level: overallConfidence
      },
      section_bullets: sectionBullets,  // 新：按 section 組織
      primary_signals: signalPatch.primarySignals,  // PATCH: Top 3 signals
      secondary_context: signalPatch.secondaryContext,  // PATCH: Supporting context
      regime_sentence: signalPatch.regimeSentence,  // PATCH: Driver + Behavior
      verified_key_data: verifiedKeyData,
      narrative_states: narrativeStates,
      health_components: healthComponents,
      risk_radar: riskRadar,
      raw_news: normalizedNews,  // 保留原始資料供進階處理
      signal_stats: signalPatch.stats  // PATCH: Statistics
    };

    // 13. 儲存
    const outputFile = path.join(__dirname, '../data/runtime/latest.json');
    fs.writeFileSync(outputFile, JSON.stringify(runtimeInput, null, 2));
    
    // 14. IDEMPOTENCY v0 缓存
    if (cachedNews.length > 0) {
      const lastItemTs = new Date(cachedNews[cachedNews.length - 1].pubDate).getTime();
      idempotencyCache.set(today, cachedNews.length, lastItemTs, runtimeInput);
    }
    
    // 15. 儲存到時間序列資料庫
    try {
      // 儲存市場數據
      if (marketData.tw_stock) {
        await this.timeseriesStorage.saveMarketData(today, 'TWII', marketData.tw_stock.data);
      }
      if (marketData.us_stock?.gspc) {
        await this.timeseriesStorage.saveMarketData(today, 'SPX', marketData.us_stock.gspc.data);
      }
      if (marketData.fx) {
        await this.timeseriesStorage.saveMarketData(today, 'USDTWD', marketData.fx.data);
      }
      
      // 儲存新聞
      if (normalizedNews.length > 0) {
        await this.timeseriesStorage.saveNews(today, normalizedNews);
      }
      
      console.log('💾 時間序列資料已儲存');
    } catch (err) {
      console.error('⚠️  時間序列儲存失敗:', err.message);
      // 不拋出錯誤，避免影響主流程
    }
    
    console.log(`\n✅ Runtime Input 已生成`);
    console.log(`   Importance: ${overallImportance}`);
    console.log(`   Materials: ${normalizedNews.length}`);
    console.log(`   Market Data: ${Object.keys(verifiedKeyData).length} field(s)`);
    
    return runtimeInput;
  }

  buildVerifiedKeyData(marketData) {
    const verified = {};

    // 台股
    if (marketData.tw_stock) {
      const tw = marketData.tw_stock.data;
      const indicators = marketData.tw_stock_indicators?.data || {};
      const meta = marketData.tw_stock.metadata;
      
      verified.tw_stock = {
        taiex_close: tw.close || null,
        taiex_change_pct: tw.changePct != null ? parseFloat(tw.changePct.toFixed(2)) : null,
        volume_billion_twd: tw.volume ? parseFloat((tw.volume / 1e8).toFixed(0)) : null,
        ma5: indicators.ma5 || null,
        ma20: indicators.ma20 || null,
        rsi: indicators.rsi || null,
        as_of: this.getAsOfContext(meta.timestamp),
        confidence_tier: this.mapConfidenceTier(meta.confidence),
        source: meta.source,
        timestamp: meta.timestamp
      };
    }

    // 美股
    if (marketData.us_stock) {
      const sp500 = marketData.us_stock.gspc?.data;
      const nasdaq = marketData.us_stock.ixic?.data;
      const meta = marketData.us_stock.gspc?.metadata;
      
      if (sp500 && meta) {
        verified.us_stock = {
          sp500_close: sp500.close || null,
          sp500_change_pct: sp500.changePct != null ? parseFloat(sp500.changePct.toFixed(2)) : null,
          nasdaq_change_pct: nasdaq?.changePct != null ? parseFloat(nasdaq.changePct.toFixed(2)) : null,
          as_of: 'US_CLOSE',
          confidence_tier: this.mapConfidenceTier(meta.confidence),
          source: meta.source,
          timestamp: meta.timestamp
        };
      }
    }

    // 匯率
    if (marketData.fx) {
      const fx = marketData.fx.data;
      const meta = marketData.fx.metadata;
      
      verified.fx = {
        usdtwd: fx.close ? parseFloat(fx.close.toFixed(2)) : null,
        usdtwd_change_pct: fx.changePct != null ? parseFloat(fx.changePct.toFixed(2)) : null,
        as_of: this.getAsOfContext(meta.timestamp),
        confidence_tier: this.mapConfidenceTier(meta.confidence),
        source: meta.source,
        timestamp: meta.timestamp
      };
    }

    return verified;
  }

  getAsOfContext(timestamp) {
    const now = Date.now();
    const dataTime = new Date(timestamp).getTime();
    const ageHours = (now - dataTime) / (1000 * 60 * 60);
    
    if (ageHours < 1) return 'INTRADAY';
    if (ageHours < 24) return 'PREVIOUS_CLOSE';
    return 'DELAYED';
  }

  mapConfidenceTier(confidence) {
    const map = {
      'HIGH': 'A',
      'MEDIUM': 'B',
      'LOW': 'C',
      'NONE': 'D'
    };
    return map[confidence] || 'D';
  }

  buildNarrativeStates(news, marketData) {
    const critical = news.filter(n => n.importance === 'CRITICAL');
    const high = news.filter(n => n.importance === 'HIGH');

    let macroTheme = '市場持穩';
    let taiwanFocus = '';
    const riskFactors = [];

    // 從重要新聞提取主題
    if (critical.length > 0) {
      macroTheme = this.cleanTitle(critical[0].title);
    } else if (high.length > 0) {
      macroTheme = this.cleanTitle(high[0].title);
    }

    // 台灣焦點 - 優化偵測邏輯
    const taiwanKeywords = this.config.importance_rules.taiwan_keywords || 
      ['台股', '台積電', '聯電', '鴻海', '台灣', 'TSMC', '台北股市'];
    
    // 必須標題包含台灣關鍵字，不只看來源
    const twNews = news.filter(n => {
      const title = n.title;
      return taiwanKeywords.some(kw => title.includes(kw));
    });

    if (twNews.length > 0) {
      // 優先選擇 HIGH 或 CRITICAL 的台灣新聞
      const importantTwNews = twNews.filter(n => 
        n.importance === 'HIGH' || n.importance === 'CRITICAL'
      );
      
      if (importantTwNews.length > 0) {
        taiwanFocus = this.cleanTitle(importantTwNews[0].title);
      } else {
        taiwanFocus = this.cleanTitle(twNews[0].title);
      }
    }

    // 風險因素
    if (critical.length > 0) {
      riskFactors.push(...critical.map(n => this.cleanTitle(n.title)).slice(0, 2));
    }

    return {
      macro_theme: macroTheme,
      taiwan_focus: taiwanFocus,
      risk_factors: riskFactors
    };
  }

  cleanTitle(title) {
    // 移除新聞標題的 emoji 前綴
    return title.replace(/^[🚨📌ℹ️⭐]\s*/, '');
  }

  deduplicateEvents(articles) {
    // Event 去重：移除語意相似的事件，每個事件只保留一次
    const uniqueEvents = [];
    const seenTopics = new Set();

    for (const article of articles) {
      const topic = this.extractTopic(article.title);
      
      if (!seenTopics.has(topic)) {
        uniqueEvents.push(article);
        seenTopics.add(topic);
      }
    }

    return uniqueEvents;
  }

  extractTopic(title) {
    // 簡化版主題提取（關鍵實體）
    const entities = [
      'Fed', 'TSMC', '台積電', 'Trump', 'Warsh', 'Bitcoin', '比特幣',
      'S&P 500', 'Nasdaq', 'TAIEX', '台股', 'GDP', 'CPI', '央行'
    ];

    for (const entity of entities) {
      if (title.includes(entity)) {
        return entity;
      }
    }

    // 無明確實體，用標題前半段
    return title.slice(0, 20);
  }

  assessOverallConfidence(marketData) {
    // 根據 Confidence Tier Distribution 判斷整體信心度
    const tiers = [];
    const asOfContexts = [];
    
    Object.values(marketData).forEach(market => {
      if (market.metadata) {
        tiers.push(this.mapConfidenceTier(market.metadata.confidence));
      }
      if (market.data) {
        // 從 verified_key_data 取得 as_of (已在 buildVerifiedKeyData 中設定)
      }
    });

    const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
    tiers.forEach(tier => tierCounts[tier]++);

    // 判斷是否為週末/非交易時間
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=週日, 6=週六
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // 規則（選項 A：週末寬容）：
    // HIGH: 所有數據都是 A 或 B
    // MEDIUM: 
    //   - 存在 C 但無 D
    //   - 或週末時即使全是 C 也算 MEDIUM（數據延遲是正常的）
    // LOW: 
    //   - 存在 D（數據缺失）
    //   - 或平日時全是 C/D（異常延遲）

    if (tierCounts.A + tierCounts.B === tiers.length && tiers.length > 0) {
      return 'HIGH';
    }

    if (tierCounts.D > 0) {
      return 'LOW';
    }

    // 週末 + 延遲數據 = MEDIUM（正常）
    if (isWeekend && tierCounts.C > 0) {
      return 'MEDIUM';
    }

    // 平日 + 全是 C/D = LOW（異常）
    if (!isWeekend && tierCounts.C + tierCounts.D === tiers.length && tiers.length > 0) {
      return 'LOW';
    }

    return 'MEDIUM';
  }

  buildHealthComponents(news, marketData) {
    const missingFields = [];
    if (!marketData.tw_stock) missingFields.push('tw_stock');
    if (!marketData.us_stock) missingFields.push('us_stock');
    if (!marketData.fx) missingFields.push('fx');

    // Confidence tier distribution
    const tierDist = { A: 0, B: 0, C: 0, D: 0 };
    Object.values(marketData).forEach(market => {
      if (market.metadata) {
        const tier = this.mapConfidenceTier(market.metadata.confidence);
        tierDist[tier]++;
      }
    });

    // External data status
    const externalStatus = [];
    if (marketData.tw_stock) externalStatus.push('Yahoo Finance: ACTIVE');
    if (marketData.us_stock) externalStatus.push('US Market Data: ACTIVE');
    if (marketData.fx) externalStatus.push('FX Data: ACTIVE');

    const alerts = [];
    if (news.length < this.config.processing.min_news_count) {
      alerts.push(`Material count below threshold (${news.length}/${this.config.processing.min_news_count})`);
    }
    if (tierDist.C + tierDist.D > 0) {
      alerts.push(`Low confidence data detected: ${tierDist.C + tierDist.D} field(s)`);
    }

    return {
      missing_data_fields: missingFields,
      confidence_tier_distribution: tierDist,
      external_data_status: externalStatus,
      ocr_quality: 'N/A',  // 未來擴充
      alerts: alerts
    };
  }
}

module.exports = RuntimeInputGenerator;
