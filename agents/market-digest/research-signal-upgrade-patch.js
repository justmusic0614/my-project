// RESEARCH_SIGNAL_UPGRADE_PATCH
// 升級新聞事件 → Research Signal
// 規則：PRIMARY_SIGNAL_LIMIT=3 + MACRO_HIERARCHY + EVENT_CAUSE_MAPPING

/**
 * MACRO_HIERARCHY_ORDER
 * 按宏觀影響力排序（最高優先級 → 最低）
 */
const MACRO_HIERARCHY = {
  'Rates': 100,       // 利率政策
  'USD': 90,          // 美元/流動性
  'Liquidity': 85,    // 流動性/QE/縮表
  'Energy': 80,       // 能源/原油
  'SafeHaven': 70,    // 避險資產（黃金/美債）
  'Equities': 60,     // 股市結構
  'Crypto': 50,       // 加密貨幣
  'Other': 40,        // 其他
};

/**
 * 關鍵字映射（用於分類事件）
 */
const MACRO_KEYWORDS = {
  'Rates': ['Fed', '聯準會', '鮑爾', '降息', '升息', '利率', '貨幣政策', '央行'],
  'USD': ['美元', '美元指數', 'DXY', '台幣', '匯率'],
  'Liquidity': ['縮表', 'QE', '流動性', '量化寬鬆', '資金面'],
  'Energy': ['原油', '油價', 'WTI', '能源', '天然氣'],
  'SafeHaven': ['黃金', '金價', '美債', '避險', '公債'],
  'Equities': ['股市', '台股', '美股', 'S&P', 'Nasdaq', '加權指數', '科技股'],
  'Crypto': ['比特幣', 'Bitcoin', '加密', '以太坊', 'ETH'],
};

/**
 * RULE 1: 事件分類並評分
 * 將每個新聞事件分類到 MACRO_HIERARCHY，並計算優先級分數
 */
function classifyAndScoreEvents(newsItems) {
  return newsItems.map(news => {
    let category = 'Other';
    let score = MACRO_HIERARCHY['Other'];
    
    // 按優先級檢查關鍵字（先檢查高優先級）
    for (const [cat, keywords] of Object.entries(MACRO_KEYWORDS)) {
      if (keywords.some(kw => news.includes(kw))) {
        category = cat;
        score = MACRO_HIERARCHY[cat];
        break;
      }
    }
    
    return { news, category, score };
  });
}

/**
 * RULE 2: PRIMARY_SIGNAL_LIMIT=3
 * 只保留前 3 個最高優先級的訊號
 */
function selectPrimarySignals(scoredEvents) {
  // 按分數排序（高 → 低）
  const sorted = [...scoredEvents].sort((a, b) => b.score - a.score);
  
  // 選前 3 個
  const primary = sorted.slice(0, 3);
  const secondary = sorted.slice(3);
  
  return { primary, secondary };
}

/**
 * RULE 3: DUPLICATE_THEME_COLLAPSE
 * 合併相同 macro theme 的標題
 */
function collapseThemes(events) {
  const themeMap = new Map();
  
  for (const event of events) {
    const { category, news } = event;
    
    if (!themeMap.has(category)) {
      themeMap.set(category, []);
    }
    themeMap.get(category).push(news);
  }
  
  // 每個 category 只保留最詳細的一條（最長）
  const collapsed = [];
  for (const [category, newsList] of themeMap.entries()) {
    const canonical = newsList.reduce((a, b) => a.length > b.length ? a : b);
    const score = MACRO_HIERARCHY[category];
    collapsed.push({ news: canonical, category, score });
  }
  
  return collapsed;
}

/**
 * RULE 4: EVENT_CAUSE_MAPPING
 * 格式化為 "Macro Driver → Market Impact → Asset Class"
 */
function formatAsCausalSignal(event) {
  const { news, category } = event;
  
  // 簡化版：保留原始新聞，加上 category 標籤
  return `[${category}] ${news}`;
}

/**
 * RULE 5: REGIME_SENTENCE_RULE
 * 必須包含（Driver + Market Behavior）
 */
function generateRegimeSentence(primarySignals) {
  if (primarySignals.length === 0) {
    return '市場處於觀望狀態，等待關鍵數據與政策訊號';
  }
  
  // 取得主要驅動因素（第一個 primary signal 的 category）
  const topDriver = primarySignals[0].category;
  
  // 分析市場行為（基於訊號內容）
  const allNews = primarySignals.map(s => s.news).join(' ');
  const hasVolatility = /震盪|波動|分化|回落|反彈/i.test(allNews);
  const hasRisk = /暴跌|重挫|風險|下跌/i.test(allNews);
  const hasRally = /大漲|上漲|反彈|走強/i.test(allNews);
  
  let marketBehavior = '橫向整理';
  if (hasRisk) {
    marketBehavior = '風險規避';
  } else if (hasRally) {
    marketBehavior = '反彈走強';
  } else if (hasVolatility) {
    marketBehavior = '區間震盪';
  }
  
  // Driver + Market Behavior
  const driverName = {
    'Rates': '利率政策',
    'USD': '美元走勢',
    'Liquidity': '流動性',
    'Energy': '能源價格',
    'SafeHaven': '避險需求',
    'Equities': '股市動能',
    'Crypto': '加密貨幣',
    'Other': '市場情緒'
  }[topDriver] || '市場動態';
  
  return `${driverName}主導市場，呈現${marketBehavior}格局`;
}

/**
 * RULE 6: SECONDARY_EVENT_RENDER
 * 將非主要事件轉為 supporting context lines（簡化版）
 */
function renderSecondaryContext(secondaryEvents) {
  if (secondaryEvents.length === 0) {
    return [];
  }
  
  // 簡化：列出 category + count
  const categoryCount = {};
  for (const event of secondaryEvents) {
    const cat = event.category;
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  }
  
  const context = [];
  for (const [cat, count] of Object.entries(categoryCount)) {
    context.push(`${cat}: ${count} 則補充訊號`);
  }
  
  return context;
}

/**
 * 應用完整 RESEARCH_SIGNAL_UPGRADE_PATCH
 */
function applyResearchSignalPatch(newsItems) {
  console.log(`\n🔧 應用 RESEARCH_SIGNAL_UPGRADE_PATCH...`);
  console.log(`   輸入新聞：${newsItems.length} 條`);
  
  // STEP 1: 分類並評分
  const scored = classifyAndScoreEvents(newsItems);
  console.log(`   ✅ STEP 1: 事件分類完成`);
  
  // STEP 2: 合併相同主題（去重）
  const collapsed = collapseThemes(scored);
  console.log(`   ✅ STEP 2: 主題合併後：${collapsed.length} 條`);
  
  // STEP 3: 選擇 PRIMARY_SIGNAL (limit=3)
  const { primary, secondary } = selectPrimarySignals(collapsed);
  console.log(`   ✅ STEP 3: Primary Signals: ${primary.length} | Secondary: ${secondary.length}`);
  
  // STEP 4: 格式化為 causal signal
  const primaryFormatted = primary.map(formatAsCausalSignal);
  console.log(`   ✅ STEP 4: Causal mapping 完成`);
  
  // STEP 5: 生成 Regime Sentence
  const regime = generateRegimeSentence(primary);
  console.log(`   ✅ STEP 5: Regime Sentence: "${regime}"`);
  
  // STEP 6: Secondary context
  const context = renderSecondaryContext(secondary);
  console.log(`   ✅ STEP 6: Secondary Context: ${context.length} 項`);
  
  return {
    primarySignals: primaryFormatted,
    secondaryContext: context,
    regimeSentence: regime,
    stats: {
      input: newsItems.length,
      collapsed: collapsed.length,
      primary: primary.length,
      secondary: secondary.length
    }
  };
}

module.exports = {
  applyResearchSignalPatch,
  classifyAndScoreEvents,
  selectPrimarySignals,
  collapseThemes,
  formatAsCausalSignal,
  generateRegimeSentence,
  renderSecondaryContext,
  MACRO_HIERARCHY,
  MACRO_KEYWORDS
};
