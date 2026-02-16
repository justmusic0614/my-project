#!/usr/bin/env node
/**
 * AI Client for News Analysis
 * 規則引擎版本（可輕鬆升級為真實 AI）
 */

const fs = require('fs').promises;
const path = require('path');

class AIClient {
  constructor(config = {}) {
    this.config = config;
    this.watchlist = config.watchlist || [];
    
    // 載入評分規則
    this.importanceRules = this.loadImportanceRules();
 // ===== SRE GUARD CONFIG =====
this.sre = {
  timeoutMs: 12000,
  maxRetry: 2,
  backoffMs: 800,
  circuitFailThreshold: 5,
  circuitCooldownMs: 60000,
  failCount: 0,
  circuitOpenUntil: 0
};
 }
async safeFetch(url, options = {}) {
  const now = Date.now();

  if (now < this.sre.circuitOpenUntil) {
    throw new Error("Circuit breaker OPEN");
  }

  let lastErr;

  for (let i = 0; i <= this.sre.maxRetry; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.sre.timeoutMs
      );

      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeout);

      this.sre.failCount = 0;
      return res;

    } catch (err) {
      lastErr = err;
      this.sre.failCount++;

      console.error("[SRE] fetch fail", err.message);

      if (this.sre.failCount >= this.sre.circuitFailThreshold) {
        this.sre.circuitOpenUntil =
          Date.now() + this.sre.circuitCooldownMs;

        console.error("[SRE] circuit OPEN");
        break;
      }

      await new Promise(r =>
        setTimeout(r, this.sre.backoffMs * (i + 1))
      );
    }
  }

  throw lastErr;
}

  /**
   * 載入重要性規則（符合 Chris 需求：A + C > E > B）
   */
  loadImportanceRules() {
    return {
      // 排除關鍵字（低價值新聞）
      exclude: {
        keywords: ['抽獎', '萊爾富', '全家', '統一超商', '便利商店', '股票抽獎', '幸運得主', '中獎'],
        penalty: -3  // 降 3 分
      },
      
      // 🔴 最高優先（10分）- 立即通知
      critical: {
        score: 10,
        // 總經數據
        macroKeywords: ['Fed決策', 'Fed會議', 'FOMC', '非農', 'CPI', 'GDP', '失業率', '央行決策', '升息', '降息', '利率決策'],
        // Watchlist 重大事件
        watchlistEvents: ['財報', '法說會', '併購', '收購', '重訊', '重大訊息', 'EPS', '營收'],
        // 黑天鵝
        blackSwan: ['黑天鵝', '崩盤', '暴跌', '暴漲', '熔斷', '停牌']
      },
      
      // 🟡 中優先（8-9分）- 每日彙整
      high: {
        score: 8,
        // 台股權值股
        majorStocks: ['台積電', 'TSMC', '鴻海', '聯發科', '台股', '加權指數', '大盤'],
        // 總經數據（次要）
        macroSecondary: ['通膨', '貿易戰', '關稅', 'PMI', '零售銷售'],
        // 產業趨勢
        industryTrends: ['AI', '半導體', '記憶體', 'DRAM', '電動車', '綠能']
      },
      
      // 🟢 低優先（6-7分）- 存檔即可
      medium: {
        score: 7,
        // 法說會預告
        eventPreview: ['法說會', '將於', '預計', '即將'],
        // 產業動態
        industry: ['產業', '供應鏈', '訂單', '出貨'],
        // 美股（非 watchlist）
        usStocks: ['美股', 'S&P', 'Nasdaq', 'Dow']
      },
      
      // 過濾（<6分）
      low: {
        score: 5,
        // 地緣政治（除非直接影響）
        geopolitics: ['地緣', '政治', '選舉'],
        // 個股（非權值股、非 watchlist）
        minorStocks: ['個股', '小型股']
      }
    };
  }

  /**
   * 分析新聞（規則引擎版本）
   */
  async analyze(news) {
    const { title, summary = '', source = '' } = news;
    const text = `${title} ${summary}`.toLowerCase();
    
    // 1. 計算基礎重要性
    let importance = this.calculateImportance(text, news);
    const baseImportance = importance;
    
    // 2. Watchlist 加權（僅在 < 10 分時）
    const inWatchlist = this.isWatchlistRelated(text);
    if (inWatchlist && importance < 10) {
      const oldImportance = importance;
      importance = Math.min(importance + 2, 10);
      console.log(`  📊 Watchlist 加權：${oldImportance} → ${importance}`);
    }
    
    // 3. 分類
    const category = this.categorize(text, source);
    
    // 4. 提取標籤
    const tags = this.extractTags(text, category);
    
    // 5. 市場意涵
    const marketImplication = this.generateImplication(importance, category, tags, inWatchlist);
    
    // 6. 影響資產
    const affectedAssets = this.extractAffectedAssets(text, tags, inWatchlist);
    
    // 7. 評分理由
    const reasoning = this.generateReasoning(importance, category, tags, inWatchlist, baseImportance);
    
    return {
      importance,
      category,
      tags,
      marketImplication,
      affectedAssets,
      reasoning,
      inWatchlist,
      priority: this.determinePriority(importance, inWatchlist),
      baseImportance  // 保留基礎分數供分析
    };
  }

  /**
   * 計算基礎重要性（1-10）
   * 符合 Chris 需求：A + C > E > B
   */
  calculateImportance(text, news) {
    const rules = this.importanceRules;
    let importance = 6;  // 預設
    
    // 1. 檢查排除關鍵字（降級）
    for (const keyword of rules.exclude.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`  ⚠️  排除關鍵字：${keyword} (${rules.exclude.penalty}分)`);
        return Math.max(importance + rules.exclude.penalty, 1);
      }
    }
    
    // 2. 檢查黑天鵝（最高優先）
    for (const keyword of rules.critical.blackSwan) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`  🚨 黑天鵝事件：${keyword}`);
        return 10;
      }
    }
    
    // 3. 檢查總經數據（10分）
    for (const keyword of rules.critical.macroKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`  📊 總經數據：${keyword}`);
        return 10;
      }
    }
    
    // 4. 檢查 Watchlist 重大事件（10分）
    const inWatchlist = this.isWatchlistRelated(text);
    if (inWatchlist) {
      for (const event of rules.critical.watchlistEvents) {
        if (text.includes(event.toLowerCase())) {
          console.log(`  💼 Watchlist 重大事件：${event}`);
          return 10;
        }
      }
    }
    
    // 5. 台股權值股（8-9分）
    for (const keyword of rules.high.majorStocks) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`  🏢 台股權值股：${keyword}`);
        return Math.random() > 0.5 ? 9 : 8;
      }
    }
    
    // 6. 總經數據（次要，8分）
    for (const keyword of rules.high.macroSecondary) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`  📈 總經次要：${keyword}`);
        return 8;
      }
    }
    
    // 7. 產業趨勢（8分）
    for (const keyword of rules.high.industryTrends) {
      // 避免 AI 誤判（如 D'Amaro）
      if (keyword === 'AI' || keyword === 'ai') {
        if (text.match(/\bai\b/i) || text.includes('人工智慧')) {
          console.log(`  🔬 產業趨勢：${keyword}`);
          return 8;
        }
      } else if (text.includes(keyword.toLowerCase())) {
        console.log(`  🔬 產業趨勢：${keyword}`);
        return 8;
      }
    }
    
    // 8. 法說會預告（7分）
    for (const keyword of rules.medium.eventPreview) {
      if (text.includes(keyword.toLowerCase())) {
        console.log(`  📅 法說會預告：${keyword}`);
        return 7;
      }
    }
    
    // 9. 產業動態（7分）
    for (const keyword of rules.medium.industry) {
      if (text.includes(keyword.toLowerCase())) {
        return 7;
      }
    }
    
    // 10. 美股（非 watchlist，6-7分）
    for (const keyword of rules.medium.usStocks) {
      if (text.includes(keyword.toLowerCase())) {
        return 6;
      }
    }
    
    // 11. 地緣政治（5分，除非直接影響市場）
    for (const keyword of rules.low.geopolitics) {
      if (text.includes(keyword.toLowerCase())) {
        // 檢查是否直接影響市場
        if (text.includes('台股') || text.includes('美股') || text.includes('市場')) {
          return 7;
        }
        return 5;
      }
    }
    
    // 預設
    return importance;
  }

  /**
   * 分類新聞
   */
  categorize(text, source) {
    // 總經
    if (text.match(/fed|cpi|gdp|降息|升息|央行|非農|失業率|通膨/i)) {
      return '總經';
    }
    
    // 台股
    if (text.match(/台股|加權|台積電|鴻海|聯發科|台灣|twii/i) || source.includes('台股')) {
      return '台股';
    }
    
    // 美股
    if (text.match(/美股|s&p|nasdaq|dow|apple|nvidia|meta|google/i) || source.includes('CNBC')) {
      return '美股';
    }
    
    // 產業
    if (text.match(/半導體|記憶體|ai|電動車|生技|金融|能源/i)) {
      return '產業';
    }
    
    // 法說會
    if (text.match(/法說會|法人說明會|investor conference/i)) {
      return '法說會';
    }
    
    // 商品
    if (text.match(/黃金|原油|商品|commodity|gold|oil/i)) {
      return '商品';
    }
    
    return '其他';
  }

  /**
   * 提取標籤
   */
  extractTags(text, category) {
    const tags = [];
    
    // 產業標籤
    if (text.includes('ai') || text.includes('人工智慧')) tags.push('AI');
    if (text.includes('半導體') || text.includes('semiconductor')) tags.push('半導體');
    if (text.includes('記憶體') || text.includes('dram')) tags.push('記憶體');
    if (text.includes('電動車') || text.includes('ev')) tags.push('電動車');
    
    // 總經標籤
    if (text.includes('fed') || text.includes('聯準會')) tags.push('Fed');
    if (text.includes('降息') || text.includes('降息')) tags.push('降息');
    if (text.includes('升息')) tags.push('升息');
    if (text.includes('非農')) tags.push('非農');
    if (text.includes('cpi') || text.includes('通膨')) tags.push('CPI');
    
    // 個股標籤
    if (text.includes('台積電') || text.includes('tsmc')) tags.push('台積電');
    if (text.includes('聯發科')) tags.push('聯發科');
    if (text.includes('鴻海')) tags.push('鴻海');
    if (text.includes('南亞科')) tags.push('南亞科');
    
    // 事件標籤
    if (text.includes('財報')) tags.push('財報');
    if (text.includes('法說會')) tags.push('法說會');
    if (text.includes('併購') || text.includes('收購')) tags.push('併購');
    
    // 去重並限制數量
    return [...new Set(tags)].slice(0, 5);
  }

  /**
   * 生成市場意涵
   */
  generateImplication(importance, category, tags, inWatchlist) {
    if (importance >= 10) {
      return '重大事件，市場波動可能加劇';
    }
    
    if (importance >= 8) {
      if (category === '總經') return 'Fed 政策預期調整，影響風險資產';
      if (category === '台股') return '權值股帶動台股情緒';
      if (category === '產業') return '產業趨勢明確，族群輪動可期';
    }
    
    if (importance >= 7) {
      if (inWatchlist) return '追蹤個股有重要消息，建議關注';
      return '一般性利多/利空，短線影響';
    }
    
    return '資訊參考';
  }

  /**
   * 提取影響資產
   */
  extractAffectedAssets(text, tags, inWatchlist) {
    const assets = [];
    
    // 從標籤提取
    const stockTags = ['台積電', '聯發科', '鴻海', '南亞科'];
    assets.push(...tags.filter(tag => stockTags.includes(tag)));
    
    // 從 Watchlist 提取
    if (inWatchlist) {
      for (const stock of this.watchlist) {
        if (text.includes(stock.name.toLowerCase())) {
          assets.push(stock.name);
        }
      }
    }
    
    // 類別資產
    if (text.includes('台股') || text.includes('加權')) assets.push('台股');
    if (text.includes('美股') || text.includes('s&p')) assets.push('美股');
    if (text.includes('黃金')) assets.push('黃金');
    if (text.includes('美元')) assets.push('美元');
    
    return [...new Set(assets)].slice(0, 5);
  }

  /**
   * 生成評分理由
   */
  generateReasoning(importance, category, tags, inWatchlist, baseImportance = null) {
    const reasons = [];
    
    if (importance >= 10) {
      if (inWatchlist) {
        reasons.push('Watchlist 個股重大事件');
      } else {
        reasons.push('重大總經數據或黑天鵝');
      }
    } else if (importance >= 8) {
      reasons.push(`${category}重要消息`);
    } else if (importance >= 7) {
      reasons.push('產業趨勢或個股動態');
    } else if (importance >= 6) {
      reasons.push('一般新聞');
    } else {
      reasons.push('低價值或地緣政治');
    }
    
    if (inWatchlist && baseImportance && importance > baseImportance) {
      reasons.push(`Watchlist 加權 +${importance - baseImportance}分`);
    }
    
    if (tags.length > 0) {
      reasons.push(`關鍵標籤：${tags.slice(0, 3).join('、')}`);
    }
    
    return reasons.join('；');
  }

  /**
   * 判斷優先級
   */
  determinePriority(importance, inWatchlist) {
    if (importance >= 10) return 'critical';
    if (importance >= 8) return 'high';
    if (importance >= 7) return 'medium';
    if (importance >= 6 && inWatchlist) return 'medium';  // Watchlist 個股至少 medium
    return 'low';
  }

  /**
   * 檢查是否與 Watchlist 相關
   */
  isWatchlistRelated(text) {
    for (const stock of this.watchlist) {
      if (text.includes(stock.name.toLowerCase()) || 
          text.includes(stock.code)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 批次分析
   */
  async analyzeAll(newsList) {
    const analyzed = [];
    
    for (const news of newsList) {
      const analysis = await this.analyze(news);
      analyzed.push({
        ...news,
        analysis
      });
    }
    
    return analyzed;
  }
}

module.exports = AIClient;
