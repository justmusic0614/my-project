/**
 * Deduplicator — 新聞去重處理器
 * Phase 3 第二步：整合多源新聞，移除重複條目
 *
 * 去重策略（依序執行）：
 *   1. Exact URL 去重（同一 URL 只保留一次）
 *   2. 標題前綴匹配（前 15 字相同視為重複）
 *   3. Jaccard 相似度（閾值 0.75）
 *   4. 關鍵字重疊（5個以上關鍵字相同）
 *
 * 設計原則：
 *   - 保留優先級最高的版本（P0 > P1 > P2 > P3）
 *   - 同優先級時保留最早時間戳（第一手來源）
 *   - 不跨日去重（避免舊聞誤判）
 */

'use strict';

const SharedDeduplicator = require('../shared/deduplicator');
const { createLogger } = require('../shared/logger');

const logger = createLogger('processor:deduplicator');

// 重要性優先序
const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

class NewsDeduplicator {
  constructor(options = {}) {
    this.jaccardThreshold  = options.jaccardThreshold  ?? 0.75;
    this.keywordOverlapMin = options.keywordOverlapMin ?? 5;
    this.titlePrefixLen    = options.titlePrefixLen    ?? 15;

    this._jaccard  = new SharedDeduplicator({ algorithm: 'jaccard',      threshold:          this.jaccardThreshold });
    this._keyword  = new SharedDeduplicator({ algorithm: 'keywords',     keywordOverlapMin:  this.keywordOverlapMin });
    this._prefix   = new SharedDeduplicator({ algorithm: 'title-prefix', titlePrefixLength:  this.titlePrefixLen });
  }

  /**
   * 主去重方法
   * @param {object[]} newsItems - 來自 rss/perplexity/sec 的新聞陣列
   * @returns {{ unique: NewsItem[], removed: object[], report: object }}
   */
  deduplicate(newsItems) {
    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      return { unique: [], removed: [], report: { total: 0, removed: 0, passes: [] } };
    }

    const report = { total: newsItems.length, removed: 0, passes: [] };
    let current = [...newsItems];
    let removed  = [];

    // Pass 1: URL 精確去重
    const urlPass = this._deduplicateByUrl(current);
    removed  = removed.concat(urlPass.removed);
    current  = urlPass.unique;
    report.passes.push({ name: 'url-exact', removed: urlPass.removed.length });

    // Pass 2: 標題前綴去重
    const prefixPass = this._deduplicateByStrategy(current, this._prefix, 'title-prefix');
    removed  = removed.concat(prefixPass.removed);
    current  = prefixPass.unique;
    report.passes.push({ name: 'title-prefix', removed: prefixPass.removed.length });

    // Pass 3: Jaccard 相似度去重
    const jaccardPass = this._deduplicateByStrategy(current, this._jaccard, 'jaccard');
    removed  = removed.concat(jaccardPass.removed);
    current  = jaccardPass.unique;
    report.passes.push({ name: 'jaccard', removed: jaccardPass.removed.length });

    // Pass 4: 關鍵字重疊去重
    const kwPass = this._deduplicateByStrategy(current, this._keyword, 'keyword-overlap');
    removed  = removed.concat(kwPass.removed);
    current  = kwPass.unique;
    report.passes.push({ name: 'keyword-overlap', removed: kwPass.removed.length });

    report.removed = removed.length;

    logger.info('news deduplication complete', {
      total:   report.total,
      unique:  current.length,
      removed: report.removed
    });

    return { unique: current, removed, report };
  }

  /**
   * Pass 1: URL 去重（完全相同的 URL 只保留優先級最高的）
   */
  _deduplicateByUrl(items) {
    const urlMap = new Map(); // url → best item

    for (const item of items) {
      const url = item.url || '';
      if (!url) continue; // 無 URL 不做 URL 去重

      const existing = urlMap.get(url);
      if (!existing || this._isBetter(item, existing)) {
        urlMap.set(url, item);
      }
    }

    const uniqueUrls = new Set(urlMap.values());
    const unique  = items.filter(item => !item.url || uniqueUrls.has(item));
    const removed = items.filter(item => item.url && !uniqueUrls.has(item));

    return { unique, removed };
  }

  /**
   * Pass 2-4: 通用策略去重（使用 SharedDeduplicator）
   * 對自身做去重，優先保留優先級高的版本
   */
  _deduplicateByStrategy(items, deduplicator, name) {
    if (items.length <= 1) return { unique: items, removed: [] };

    const unique  = [];
    const removed = [];

    for (const item of items) {
      let isDup = false;
      for (let i = 0; i < unique.length; i++) {
        if (deduplicator.isDuplicate(item, [unique[i]])) {
          // 保留優先級較高的
          if (this._isBetter(item, unique[i])) {
            removed.push(unique[i]);
            unique[i] = item;
          } else {
            removed.push(item);
          }
          isDup = true;
          break;
        }
      }
      if (!isDup) unique.push(item);
    }

    return { unique, removed };
  }

  /**
   * 判斷 a 是否比 b 更值得保留
   * 優先：P0 > P1 > P2 > P3，同級則時間早優先
   */
  _isBetter(a, b) {
    const pa = PRIORITY_ORDER[a.importance] ?? 3;
    const pb = PRIORITY_ORDER[b.importance] ?? 3;
    if (pa !== pb) return pa < pb;
    // 同優先級：時間早優先（第一手）
    return new Date(a.publishedAt) < new Date(b.publishedAt);
  }
}

// 單例
const newsDeduplicator = new NewsDeduplicator();

module.exports = newsDeduplicator;
module.exports.NewsDeduplicator = NewsDeduplicator;
