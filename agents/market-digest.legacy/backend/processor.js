// News Processor - 去重 + 格式化 + 重要性評分
class NewsProcessor {
  constructor(config) {
    this.config = config;
    this.dedupThreshold = config.processing.dedup_threshold || 0.85;
  }

  // 標題相似度去重（Levenshtein distance）
  deduplicateByTitle(articles) {
    const unique = [];
    
    for (const article of articles) {
      const isDuplicate = unique.some(existing => 
        this.similarity(article.title, existing.title) > this.dedupThreshold
      );
      
      if (!isDuplicate) {
        unique.push(article);
      }
    }

    console.log(`📊 去重：${articles.length} → ${unique.length} 則新聞`);
    return unique;
  }

  // 字串相似度計算（簡化版 Levenshtein）
  similarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  levenshteinDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  // 評估新聞重要性
  assessImportance(article, marketData) {
    let score = 0;
    const title = article.title.toLowerCase();
    const summary = (article.summary || '').toLowerCase();
    const text = title + ' ' + summary;

    // 關鍵字檢查
    const criticalKeywords = this.config.importance_rules.critical_keywords;
    const highKeywords = this.config.importance_rules.high_keywords;

    if (criticalKeywords.some(kw => text.includes(kw.toLowerCase()))) {
      return 'CRITICAL';
    }

    if (highKeywords.some(kw => text.includes(kw.toLowerCase()))) {
      score += 2;
    }

    // 市場異動檢查
    if (marketData) {
      const tw = marketData.tw_stock?.data;
      if (tw && Math.abs(tw.changePct) > this.config.importance_rules.price_change_threshold) {
        score += 1;
      }
    }

    // 時效性
    const age = Date.now() - new Date(article.pubDate).getTime();
    const ageHours = age / (1000 * 60 * 60);
    if (ageHours < 2) score += 1;

    if (score >= 3) return 'HIGH';
    if (score >= 1) return 'MEDIUM';
    return 'LOW';
  }

  // 標準化新聞摘要
  normalizeNews(articles, marketData, maxItems = 10) {
    // 依重要性排序
    const scored = articles.map(article => ({
      ...article,
      importance: this.assessImportance(article, marketData)
    }));

    const sorted = scored.sort((a, b) => {
      const importanceOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      const diff = importanceOrder[b.importance] - importanceOrder[a.importance];
      if (diff !== 0) return diff;
      
      // 同重要性，依時間排序
      return new Date(b.pubDate) - new Date(a.pubDate);
    });

    return sorted.slice(0, maxItems);
  }

  // 產生摘要 bullet points
  generateSummaryBullets(articles) {
    return articles.map(article => {
      const emoji = this.getImportanceEmoji(article.importance);
      return `${emoji} ${article.title}`;
    });
  }

  getImportanceEmoji(importance) {
    const map = {
      CRITICAL: '🚨',
      HIGH: '⭐',
      MEDIUM: '📌',
      LOW: 'ℹ️'
    };
    return map[importance] || 'ℹ️';
  }

  // 判斷整體重要性
  assessOverallImportance(articles) {
    if (articles.some(a => a.importance === 'CRITICAL')) return 'CRITICAL';
    if (articles.filter(a => a.importance === 'HIGH').length >= 3) return 'HIGH';
    if (articles.some(a => a.importance === 'HIGH')) return 'MEDIUM';
    return 'LOW';
  }
}

module.exports = NewsProcessor;
