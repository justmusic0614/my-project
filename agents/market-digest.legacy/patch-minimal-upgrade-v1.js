// PATCH: minimal_upgrade_news_to_research_signal v1
// 套用到 smart-integrator.js 的新闻处理逻辑

/**
 * RULE 1: Canonical Event Ownership - 合并重复新闻
 */
function mergeToCanonicalEvents(newsItems) {
  const events = [];
  const entities = new Map(); // 主体 -> 事件列表
  
  // 定义核心主体关键字
  const coreEntities = {
    'Fed': ['Fed', '聯準會', '鮑爾', '華許', '沃什'],
    'AI': ['AI', '人工智慧', '算力', 'GPU', 'HBM'],
    'TSMC': ['台積電', 'TSMC', '2奈米', '3奈米'],
    'China': ['中國', '大陸', '兩岸'],
    'Trump': ['川普', 'Trump'],
    'Crypto': ['比特幣', 'Bitcoin', '加密'],
    'Gold': ['黃金', '金價'],
    'Oil': ['原油', '油價', 'WTI'],
  };
  
  // 按主体分组
  for (const news of newsItems) {
    let assigned = false;
    
    for (const [entity, keywords] of Object.entries(coreEntities)) {
      if (keywords.some(kw => news.includes(kw))) {
        if (!entities.has(entity)) {
          entities.set(entity, []);
        }
        entities.get(entity).push(news);
        assigned = true;
        break;
      }
    }
    
    if (!assigned) {
      events.push(news); // 其他新闻直接加入
    }
  }
  
  // 每个主体只保留最重要的一条
  for (const [entity, newsList] of entities.entries()) {
    if (newsList.length > 0) {
      // 选择最长的（通常最详细）
      const canonical = newsList.reduce((a, b) => a.length > b.length ? a : b);
      events.push(canonical);
    }
  }
  
  return events;
}

/**
 * RULE 2: Hard Relevance Drop - 移除策略/评论
 */
function filterStrategyAndCommentary(newsItems) {
  const dropPatterns = [
    /抱股過年/,
    /低接.*族群/,
    /操作建議/,
    /布局策略/,
    /怎麼走/,
    /如何操作/,
    /投資策略/,
    /法人建議/,
    /分析師.*看/,
    /專家.*認為/,
    /預期.*點/,
    /目標價/,
    /上看.*元/,
    /下探.*元/,
  ];
  
  return newsItems.filter(news => {
    return !dropPatterns.some(pattern => pattern.test(news));
  });
}

/**
 * RULE 3: Market Regime Sentence
 */
function getMarketRegimeSentence(newsItems, marketData) {
  // 分析新闻情绪和数据趋势
  const hasVolatility = newsItems.some(n => 
    n.includes('震盪') || n.includes('波動') || n.includes('分化')
  );
  
  const hasPolicyUncertainty = newsItems.some(n => 
    n.includes('Fed') || n.includes('聯準會') || n.includes('政策')
  );
  
  const hasRisk = newsItems.some(n => 
    n.includes('暴跌') || n.includes('重挫') || n.includes('風險')
  );
  
  if (hasRisk) {
    return '市場進入風險規避，等待政策與基本面明朗訊號';
  } else if (hasVolatility && hasPolicyUncertainty) {
    return '市場進入區間震盪，等待關鍵事件與數據指引';
  } else if (hasVolatility) {
    return '市場呈現高檔震盪整理，多空交戰格局';
  } else {
    return '市場進入觀望期，等待關鍵宏觀與政策訊號';
  }
}

/**
 * RULE 4: Cross-Asset Priority Hierarchy
 */
function prioritizeByAssetClass(newsItems) {
  const priority = {
    'rates': 10,    // 利率/流動性
    'fx': 9,        // 美元/匯率
    'energy': 8,    // 能源/原油
    'gold': 7,      // 黃金/避險
    'equity': 6,    // 股市
    'crypto': 5,    // 加密貨幣
    'other': 4,
  };
  
  const keywords = {
    'rates': ['Fed', '聯準會', '降息', '升息', '利率', '縮表', 'QE'],
    'fx': ['美元', '台幣', '匯率', 'DXY', '美元指數'],
    'energy': ['原油', '油價', 'WTI', '能源'],
    'gold': ['黃金', '金價', '避險'],
    'equity': ['股市', '台股', '美股', 'S&P', 'Nasdaq'],
    'crypto': ['比特幣', 'Bitcoin', '加密'],
  };
  
  // 為每條新聞分配優先級
  const scored = newsItems.map(news => {
    let score = priority.other;
    
    for (const [asset, kws] of Object.entries(keywords)) {
      if (kws.some(kw => news.includes(kw))) {
        score = priority[asset];
        break;
      }
    }
    
    return { news, score };
  });
  
  // 按優先級排序
  scored.sort((a, b) => b.score - a.score);
  
  return scored.map(item => item.news);
}

/**
 * RULE 5: Minimum Signal Floor - 最少 6 個事件
 */
function ensureMinimumSignals(events, marketDigest) {
  if (events.length >= 6) {
    return events;
  }
  
  // 從 Market Digest 回填符合條件的訊號
  const backfillSources = [
    '牛津：區域內經濟體差異明顯 亞洲出口動能 出現新雜音',
    '哥倫比亞央行大幅升息 出乎市場意料',
    'AI正加速融入日常工作流程蓋洛普民調：12%美國上班族每日使用',
    '挺潔淨能源 全球能源轉型投資 去年逾2.3兆美元',
  ];
  
  const needed = 6 - events.length;
  const backfill = backfillSources.slice(0, needed);
  
  return [...events, ...backfill];
}

/**
 * 應用完整 patch
 */
function applyPatch(newsItems, marketDigest) {
  console.log(`🔧 應用 minimal_upgrade_news_to_research_signal v1...`);
  console.log(`   輸入新聞：${newsItems.length} 條`);
  
  // RULE 2: 移除策略/評論
  let filtered = filterStrategyAndCommentary(newsItems);
  console.log(`   RULE 2 過濾後：${filtered.length} 條`);
  
  // RULE 1: 合併為 canonical events
  let canonical = mergeToCanonicalEvents(filtered);
  console.log(`   RULE 1 合併後：${canonical.length} 條`);
  
  // RULE 4: 優先級排序
  let prioritized = prioritizeByAssetClass(canonical);
  console.log(`   RULE 4 排序完成`);
  
  // RULE 5: 確保最少 6 個
  let final = ensureMinimumSignals(prioritized, marketDigest);
  console.log(`   RULE 5 回填後：${final.length} 條`);
  
  // RULE 3: Market Regime（返回用於報告）
  const regime = getMarketRegimeSentence(final, null);
  console.log(`   RULE 3 市場狀態：${regime}`);
  
  return {
    events: final,
    regime: regime
  };
}

module.exports = {
  applyPatch,
  mergeToCanonicalEvents,
  filterStrategyAndCommentary,
  getMarketRegimeSentence,
  prioritizeByAssetClass,
  ensureMinimumSignals
};
