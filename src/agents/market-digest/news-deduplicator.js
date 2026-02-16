#!/usr/bin/env node
/**
 * News Deduplicator
 * 新聞去重機制：與早報比對、標題相似度、數量限制
 */

const fs = require('fs').promises;
const path = require('path');

class NewsDeduplicator {
  constructor(config = {}) {
    this.config = config;
    this.threshold = config.dedup_threshold || 0.75;
    this.limits = config.limits || {
      critical: 3,    // 立即推播：最多 3 則
      high: 10,       // 每日彙整：最多 10 則
      medium: 30      // 月報：最多 30 則
    };
  }

  /**
   * 計算文字相似度（Jaccard Similarity）
   */
  calculateSimilarity(text1, text2) {
    const words1 = new Set(this.tokenize(text1));
    const words2 = new Set(this.tokenize(text2));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * 文字分詞
   */
  tokenize(text) {
    // 移除標點、轉小寫、分詞
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1);  // 過濾單字元
  }

  /**
   * 與早報比對去重
   */
  async compareWithMorningReport(newsList, date = null) {
    const today = date || new Date().toISOString().split('T')[0];
    const morningReportPath = path.join(
      __dirname,
      'data/morning-collect',
      `${today}.json`
    );

    let morningNews = [];
    try {
      const content = await fs.readFile(morningReportPath, 'utf8');
      const data = JSON.parse(content);
      morningNews = data.items || [];
      console.log(`📰 載入早報：${morningNews.length} 則`);
    } catch (error) {
      console.log('⚠️  無早報資料，跳過早報比對');
      return newsList;
    }

    const deduplicated = [];
    const duplicates = [];

    for (const news of newsList) {
      let isDuplicate = false;

      for (const morningItem of morningNews) {
        const similarity = this.calculateSimilarity(
          news.title,
          morningItem.content || ''
        );

        if (similarity > this.threshold) {
          isDuplicate = true;
          duplicates.push({
            news: news.title.substring(0, 60),
            morning: morningItem.content.substring(0, 60),
            similarity: similarity.toFixed(2)
          });
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(news);
      }
    }

    if (duplicates.length > 0) {
      console.log(`🔁 去重（與早報重複）：移除 ${duplicates.length} 則`);
      console.log(`   相似度閾值：${this.threshold}`);
    }

    return deduplicated;
  }

  /**
   * 標題相似度去重（同來源）
   */
  deduplicateBySimilarity(newsList) {
    const deduplicated = [];
    const seen = [];

    for (const news of newsList) {
      let isDuplicate = false;

      for (const seenNews of seen) {
        const similarity = this.calculateSimilarity(
          news.title,
          seenNews.title
        );

        if (similarity > this.threshold) {
          isDuplicate = true;
          console.log(`  🔁 標題相似：${news.title.substring(0, 40)}... (${similarity.toFixed(2)})`);
          break;
        }
      }

      if (!isDuplicate) {
        deduplicated.push(news);
        seen.push(news);
      }
    }

    if (seen.length < newsList.length) {
      console.log(`🔁 去重（標題相似）：移除 ${newsList.length - seen.length} 則`);
    }

    return deduplicated;
  }

  /**
   * 數量限制（依優先級）
   */
  applyLimits(analyzedNews) {
    // 依重要性分類
    const critical = analyzedNews.filter(n => n.analysis.priority === 'critical');
    const high = analyzedNews.filter(n => n.analysis.priority === 'high');
    const medium = analyzedNews.filter(n => n.analysis.priority === 'medium');
    const low = analyzedNews.filter(n => n.analysis.priority === 'low');

    // 套用限制
    const limitedCritical = critical.slice(0, this.limits.critical);
    const limitedHigh = high.slice(0, this.limits.high);
    const limitedMedium = medium.slice(0, this.limits.medium);

    // 統計
    const stats = {
      total: analyzedNews.length,
      critical: {
        total: critical.length,
        kept: limitedCritical.length,
        filtered: critical.length - limitedCritical.length
      },
      high: {
        total: high.length,
        kept: limitedHigh.length,
        filtered: high.length - limitedHigh.length
      },
      medium: {
        total: medium.length,
        kept: limitedMedium.length,
        filtered: medium.length - limitedMedium.length
      },
      low: {
        total: low.length,
        kept: 0,  // 完全過濾
        filtered: low.length
      }
    };

    console.log('');
    console.log('📊 數量限制統計：');
    console.log(`  🔴 Critical：${stats.critical.kept}/${stats.critical.total} 則（限制 ${this.limits.critical} 則）`);
    console.log(`  🟡 High：${stats.high.kept}/${stats.high.total} 則（限制 ${this.limits.high} 則）`);
    console.log(`  🟢 Medium：${stats.medium.kept}/${stats.medium.total} 則（限制 ${this.limits.medium} 則）`);
    console.log(`  ⚪ Low：過濾 ${stats.low.filtered} 則`);
    console.log(`  總計：保留 ${limitedCritical.length + limitedHigh.length + limitedMedium.length}/${analyzedNews.length} 則`);

    return {
      news: [...limitedCritical, ...limitedHigh, ...limitedMedium],
      stats
    };
  }

  /**
   * 同事件合併（相似新聞歸類）
   */
  mergeRelatedNews(newsList) {
    const merged = [];
    const clusters = [];

    for (const news of newsList) {
      let addedToCluster = false;

      // 尋找相似群組
      for (const cluster of clusters) {
        const similarity = this.calculateSimilarity(
          news.title,
          cluster.main.title
        );

        if (similarity > 0.5) {  // 較寬鬆的相似度（群組用）
          cluster.related.push(news);
          addedToCluster = true;
          break;
        }
      }

      // 建立新群組
      if (!addedToCluster) {
        clusters.push({
          main: news,
          related: []
        });
      }
    }

    // 組裝結果
    for (const cluster of clusters) {
      if (cluster.related.length > 0) {
        // 合併相關新聞資訊
        merged.push({
          ...cluster.main,
          relatedCount: cluster.related.length,
          relatedTitles: cluster.related.map(n => n.title)
        });
      } else {
        merged.push(cluster.main);
      }
    }

    if (clusters.some(c => c.related.length > 0)) {
      const mergedCount = clusters.filter(c => c.related.length > 0).length;
      console.log(`🔗 同事件合併：${mergedCount} 個群組`);
    }

    return merged;
  }

  /**
   * 完整去重流程
   */
  async deduplicate(analyzedNews, options = {}) {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 開始去重流程');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📥 輸入：${analyzedNews.length} 則新聞`);
    console.log('');

    let news = [...analyzedNews];

    // Step 1: 與早報比對去重
    if (options.skipMorningReport !== true) {
      console.log('📰 Step 1: 與早報比對去重');
      news = await this.compareWithMorningReport(news, options.date);
      console.log(`   保留：${news.length} 則`);
      console.log('');
    }

    // Step 2: 標題相似度去重
    if (options.skipSimilarity !== true) {
      console.log('🔍 Step 2: 標題相似度去重');
      news = this.deduplicateBySimilarity(news);
      console.log(`   保留：${news.length} 則`);
      console.log('');
    }

    // Step 3: 同事件合併
    if (options.mergeRelated === true) {
      console.log('🔗 Step 3: 同事件合併');
      news = this.mergeRelatedNews(news);
      console.log(`   保留：${news.length} 則`);
      console.log('');
    }

    // Step 4: 數量限制
    console.log('📊 Step 4: 數量限制');
    const result = this.applyLimits(news);
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ 去重完成');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📤 輸出：${result.news.length} 則（過濾 ${analyzedNews.length - result.news.length} 則）`);
    console.log('');

    return result;
  }
}

module.exports = NewsDeduplicator;
