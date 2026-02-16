/**
 * 統一去重器
 * 目的：整合 news-deduplicator.js 和 smart-integrator.js 中的去重邏輯
 * 
 * 功能：
 * - 支援多種去重策略（Jaccard, 關鍵字重疊, 標題前綴）
 * - 與參考資料集比對
 * - 可配置閾值
 * - 去重報告
 */

class Deduplicator {
  constructor(options = {}) {
    this.algorithm = options.algorithm || 'jaccard';
    this.threshold = options.threshold || 0.75;
    this.keywordOverlapMin = options.keywordOverlapMin || 3;
    this.titlePrefixLength = options.titlePrefixLength || 10;
    this.logger = options.logger || console;
    
    this.stats = {
      processed: 0,
      duplicates: 0,
      unique: 0
    };
  }

  /**
   * 主要去重方法
   * @param {Array} items - 要去重的項目列表（標題或文字）
   * @param {Array} referenceItems - 參考項目列表（用於比對）
   * @returns {Object} { unique, duplicates, stats }
   */
  deduplicate(items, referenceItems = []) {
    this.stats = { processed: 0, duplicates: 0, unique: 0 };
    
    const unique = [];
    const duplicates = [];
    
    // 先對自身去重
    const selfDeduped = this.removeSelfDuplicates(items);
    
    // 再與參考項目比對
    for (const item of selfDeduped) {
      this.stats.processed++;
      
      if (this.isDuplicate(item, referenceItems)) {
        duplicates.push(item);
        this.stats.duplicates++;
      } else {
        unique.push(item);
        this.stats.unique++;
      }
    }
    
    return {
      unique,
      duplicates,
      stats: this.getStats()
    };
  }

  /**
   * 移除自身重複
   */
  removeSelfDuplicates(items) {
    const unique = [];
    
    for (const item of items) {
      if (!this.isDuplicate(item, unique)) {
        unique.push(item);
      }
    }
    
    return unique;
  }

  /**
   * 判斷是否重複
   */
  isDuplicate(item, referenceItems) {
    for (const refItem of referenceItems) {
      let similarity;
      
      switch (this.algorithm) {
        case 'jaccard':
          similarity = this.calculateJaccardSimilarity(
            this.getText(item),
            this.getText(refItem)
          );
          if (similarity >= this.threshold) {
            return true;
          }
          break;
          
        case 'keywords':
          const overlap = this.calculateKeywordOverlap(
            this.getText(item),
            this.getText(refItem)
          );
          if (overlap >= this.keywordOverlapMin) {
            return true;
          }
          break;
          
        case 'title-prefix':
          if (this.isTitlePrefixMatch(
            this.getText(item),
            this.getText(refItem)
          )) {
            return true;
          }
          break;
          
        case 'exact':
          if (this.getText(item) === this.getText(refItem)) {
            return true;
          }
          break;
      }
    }
    
    return false;
  }

  /**
   * Jaccard Similarity（集合相似度）
   */
  calculateJaccardSimilarity(text1, text2) {
    const words1 = new Set(this.tokenize(text1));
    const words2 = new Set(this.tokenize(text2));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 關鍵字重疊數量
   */
  calculateKeywordOverlap(text1, text2) {
    const words1 = this.tokenize(text1).filter(w => w.length > 2);
    const words2 = this.tokenize(text2).filter(w => w.length > 2);
    
    return words1.filter(w => words2.includes(w)).length;
  }

  /**
   * 標題前綴匹配
   */
  isTitlePrefixMatch(text1, text2) {
    const prefix1 = text1.substring(0, this.titlePrefixLength);
    const prefix2 = text2.substring(0, this.titlePrefixLength);
    return prefix1 === prefix2;
  }

  /**
   * 文字分詞
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1);
  }

  /**
   * 從項目中提取文字（支援字串或物件）
   */
  getText(item) {
    if (typeof item === 'string') {
      return item;
    }
    // 支援 { title: ... } 或 { content: ... }
    return item.title || item.content || item.text || String(item);
  }

  /**
   * 獲取統計資訊
   */
  getStats() {
    return {
      ...this.stats,
      duplicateRate: this.stats.processed > 0
        ? `${(this.stats.duplicates / this.stats.processed * 100).toFixed(1)}%`
        : '0%',
      algorithm: this.algorithm,
      threshold: this.threshold
    };
  }

  /**
   * 批次去重（支援多個策略）
   */
  deduplicateWithMultipleStrategies(items, referenceItems = [], strategies = []) {
    let current = items;
    const report = [];
    
    for (const strategy of strategies) {
      this.algorithm = strategy.algorithm || this.algorithm;
      this.threshold = strategy.threshold || this.threshold;
      
      const result = this.deduplicate(current, referenceItems);
      current = result.unique;
      
      report.push({
        strategy: this.algorithm,
        ...result.stats
      });
    }
    
    return {
      unique: current,
      report
    };
  }
}

module.exports = Deduplicator;
