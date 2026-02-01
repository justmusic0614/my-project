// Quota Manager - MINIMUM QUOTA + BACKFILL
class QuotaManager {
  constructor(config) {
    this.config = config;
    this.targetMin = 8;
    this.targetMax = 12;
  }

  ensureMinimumQuota(routedSections, allArticles) {
    // 计算当前总数
    const currentTotal = Object.values(routedSections).reduce((sum, arr) => sum + arr.length, 0);

    if (currentTotal >= this.targetMin) {
      console.log(`✅ 事件数量充足：${currentTotal} 则`);
      return routedSections;
    }

    console.log(`⚠️  事件不足（${currentTotal}/${this.targetMin}），启动回填...`);

    // 回填优先级
    const backfillPriority = [
      { section: 'macro_policy', keywords: ['央行', 'Fed', 'ECB', '利率', '政策', '通膨', 'CPI', 'GDP'] },
      { section: 'cross_asset', keywords: ['USD', 'DXY', 'VIX', '黄金', '石油', 'WTI', '避险'] },
      { section: 'equity_market', keywords: ['AI', 'capex', 'earnings', '财报', 'GPU', '晶片'] },
      { section: 'daily_snapshot', keywords: [] } // 兜底
    ];

    // 从 allArticles 中找回填候选
    const used = new Set();
    Object.values(routedSections).forEach(articles => {
      articles.forEach(a => used.add(a.guid || a.title));
    });

    const candidates = allArticles.filter(a => !used.has(a.guid || a.title));

    // 按优先级回填
    for (const priority of backfillPriority) {
      if (currentTotal >= this.targetMin) break;

      const matches = candidates.filter(article => {
        if (priority.keywords.length === 0) return true; // daily_snapshot 兜底
        return priority.keywords.some(kw => article.title.includes(kw));
      });

      const needed = this.targetMin - currentTotal;
      const toAdd = matches.slice(0, needed);

      if (toAdd.length > 0) {
        if (!routedSections[priority.section]) {
          routedSections[priority.section] = [];
        }
        routedSections[priority.section].push(...toAdd);
        console.log(`  📥 回填 ${priority.section}: +${toAdd.length}`);
        
        toAdd.forEach(a => {
          used.add(a.guid || a.title);
          candidates.splice(candidates.indexOf(a), 1);
        });
      }
    }

    const finalTotal = Object.values(routedSections).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`✅ 回填完成，总计：${finalTotal} 则`);

    return routedSections;
  }

  enforceMaxQuota(routedSections) {
    const currentTotal = Object.values(routedSections).reduce((sum, arr) => sum + arr.length, 0);

    if (currentTotal <= this.targetMax) {
      return routedSections;
    }

    console.log(`⚠️  超过上限（${currentTotal}/${this.targetMax}），裁剪...`);

    // 按重要性裁剪（优先保留 macro/cross_asset）
    const priority = ['macro_policy', 'cross_asset', 'equity_market', 'taiwan_market', 'daily_snapshot'];
    
    let removed = 0;
    const needed = currentTotal - this.targetMax;

    // 从低优先级开始裁剪
    for (let i = priority.length - 1; i >= 0 && removed < needed; i--) {
      const section = priority[i];
      const articles = routedSections[section] || [];
      
      if (articles.length > 0) {
        const toRemove = Math.min(articles.length, needed - removed);
        routedSections[section] = articles.slice(0, articles.length - toRemove);
        removed += toRemove;
      }
    }

    return routedSections;
  }
}

module.exports = QuotaManager;
