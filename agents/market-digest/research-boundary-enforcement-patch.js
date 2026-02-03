// RESEARCH_BOUNDARY_ENFORCEMENT_PATCH v1_minimal
// Section Backfill + Equity Domain Gate + Thematic Downgrade

/**
 * PATCH 1 — SECTION BACKFILL POLICY (ANTI-N/A SECTIONS)
 * 避免空 sections，從其他訊號智慧回填
 */
const SECTION_BACKFILL_POLICY = {
  TaiwanMarket: {
    allow_from: ['Semiconductor', 'SupplyChain', 'FX', 'AIInfra', 'GlobalDemand'],
    keywords: ['台積電', 'TSMC', '半導體', '晶片', '供應鏈', '台幣', 'AI', '需求']
  },
  EventWatch: {
    allow_from: ['CentralBankPolicy', 'MacroDataRelease', 'Geopolitics', 'LiquidityEvent'],
    keywords: ['央行', '利率決策', 'GDP', 'CPI', 'PMI', '地緣', '流動性', '政策']
  }
};

/**
 * PATCH 2 — EQUITY STRUCTURE HARD DOMAIN GATE
 * 嚴格限制 Equity Market Structure 只接受財務/營運指標
 */
const EQUITY_STRUCTURE_DOMAIN_KEYWORDS = [
  'earnings', 'revenue', 'capex', 'order', 'margin', 'valuation',
  'supply chain', 'production', 'inventory cycle',
  '財報', '營收', '資本支出', '訂單', '毛利', '估值', '供應鏈', '生產', '庫存'
];

const REJECT_IF_THEMATIC_OR_ADOPTION_ONLY = true;

/**
 * PATCH 3 — THEMATIC SIGNAL DOWNGRADE (ANTI-NOISE PRIMARY)
 * 降級沒有財務傳導路徑的主題性訊號
 */
const FINANCIAL_TRANSMISSION_KEYWORDS = [
  'capex impact', 'revenue impact', 'order flow impact', 'margin impact',
  '資本支出', '營收影響', '訂單影響', '毛利影響', '盈餘', '獲利'
];

const THEMATIC_KEYWORDS = [
  'AI', '綠能', '氣候', '數位化', '科技趨勢', '採用率', '民調', '使用'
];

/**
 * PATCH 1 實作：Section Backfill
 */
function backfillSection(sectionName, primarySignals, secondarySignals, allEvents) {
  const policy = SECTION_BACKFILL_POLICY[sectionName];
  if (!policy) return []; // 未定義 backfill 規則
  
  const candidates = [];
  
  // 從 Primary Signals 找
  for (const signal of primarySignals) {
    if (matchesBackfillPolicy(signal.news, policy.keywords)) {
      candidates.push(signal.news);
    }
  }
  
  // 從 Secondary Signals 找
  for (const signal of secondarySignals) {
    if (matchesBackfillPolicy(signal.news, policy.keywords)) {
      candidates.push(signal.news);
    }
  }
  
  // 從全部事件找（最後手段）
  if (candidates.length === 0 && allEvents) {
    for (const event of allEvents) {
      if (matchesBackfillPolicy(event, policy.keywords)) {
        candidates.push(event);
      }
    }
  }
  
  return candidates.slice(0, 3); // 最多回填 3 條
}

function matchesBackfillPolicy(text, keywords) {
  const lowerText = text.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw.toLowerCase()));
}

/**
 * PATCH 2 實作：Equity Structure Domain Gate
 */
function validateEquityStructureDomain(text) {
  const lowerText = text.toLowerCase();
  
  // 檢查是否包含財務/營運關鍵字
  const hasFinancialKeyword = EQUITY_STRUCTURE_DOMAIN_KEYWORDS.some(kw => 
    lowerText.includes(kw.toLowerCase())
  );
  
  if (!hasFinancialKeyword && REJECT_IF_THEMATIC_OR_ADOPTION_ONLY) {
    // 檢查是否純主題性（無財務內容）
    const isThematicOnly = THEMATIC_KEYWORDS.some(kw => 
      lowerText.includes(kw.toLowerCase())
    );
    
    if (isThematicOnly) {
      return { valid: false, reason: 'THEMATIC_ONLY' };
    }
  }
  
  return { valid: hasFinancialKeyword, reason: hasFinancialKeyword ? 'OK' : 'NO_FINANCIAL_KEYWORD' };
}

/**
 * PATCH 3 實作：Thematic Signal Downgrade
 */
function shouldDowngradeThematic(text) {
  const lowerText = text.toLowerCase();
  
  // 檢查是否為主題性訊號
  const isThematic = THEMATIC_KEYWORDS.some(kw => 
    lowerText.includes(kw.toLowerCase())
  );
  
  if (!isThematic) {
    return { shouldDowngrade: false, reason: 'NOT_THEMATIC' };
  }
  
  // 檢查是否有財務傳導路徑
  const hasTransmission = FINANCIAL_TRANSMISSION_KEYWORDS.some(kw => 
    lowerText.includes(kw.toLowerCase())
  );
  
  if (hasTransmission) {
    return { shouldDowngrade: false, reason: 'HAS_TRANSMISSION_PATH' };
  }
  
  // 主題性且無財務傳導 → 降級
  return { shouldDowngrade: true, reason: 'THEMATIC_NO_TRANSMISSION' };
}

/**
 * 整合 Boundary Enforcement Patch
 */
function applyBoundaryPatch(sectionBullets, primarySignals, secondarySignals, allEvents) {
  console.log('\n🛡️  應用 BOUNDARY_ENFORCEMENT_PATCH v1_minimal...');
  
  const stats = {
    backfilled: [],
    equity_rejected: 0,
    thematic_downgraded: 0
  };
  
  // PATCH 1: Section Backfill（避免 N/A）
  console.log('   PATCH 1: Section Backfill...');
  
  if (!sectionBullets.taiwan_market || sectionBullets.taiwan_market.length === 0) {
    const backfill = backfillSection('TaiwanMarket', primarySignals, secondarySignals, allEvents);
    if (backfill.length > 0) {
      sectionBullets.taiwan_market = backfill;
      stats.backfilled.push('TaiwanMarket');
      console.log(`   ✅ TaiwanMarket 回填：${backfill.length} 條`);
    }
  }
  
  if (!sectionBullets.event_watch || sectionBullets.event_watch.length === 0) {
    const backfill = backfillSection('EventWatch', primarySignals, secondarySignals, allEvents);
    if (backfill.length > 0) {
      sectionBullets.event_watch = backfill;
      stats.backfilled.push('EventWatch');
      console.log(`   ✅ EventWatch 回填：${backfill.length} 條`);
    }
  }
  
  // PATCH 2: Equity Structure Domain Gate
  console.log('   PATCH 2: Equity Structure Domain Gate...');
  
  if (sectionBullets.equity_market) {
    const filtered = sectionBullets.equity_market.filter(bullet => {
      const result = validateEquityStructureDomain(bullet);
      if (!result.valid) {
        stats.equity_rejected++;
        console.log(`   ⚠️  拒絕（${result.reason}）：${bullet.substring(0, 40)}...`);
        return false;
      }
      return true;
    });
    
    sectionBullets.equity_market = filtered;
    console.log(`   ✅ Equity Structure 驗證：${filtered.length} 條保留`);
  }
  
  // PATCH 3: Thematic Signal Downgrade
  console.log('   PATCH 3: Thematic Signal Downgrade...');
  
  // 檢查 Primary Signals 中的主題性訊號
  const downgradedSignals = [];
  if (primarySignals) {
    primarySignals.forEach(signal => {
      const result = shouldDowngradeThematic(signal.news);
      if (result.shouldDowngrade) {
        downgradedSignals.push(signal);
        stats.thematic_downgraded++;
        console.log(`   ⚠️  降級主題訊號：${signal.news.substring(0, 40)}...`);
      }
    });
  }
  
  console.log(`   ✅ Boundary Enforcement 完成`);
  console.log(`      Backfilled: ${stats.backfilled.join(', ') || 'None'}`);
  console.log(`      Equity Rejected: ${stats.equity_rejected}`);
  console.log(`      Thematic Downgraded: ${stats.thematic_downgraded}`);
  
  return {
    sectionBullets,
    downgradedSignals,
    stats
  };
}

module.exports = {
  applyBoundaryPatch,
  backfillSection,
  validateEquityStructureDomain,
  shouldDowngradeThematic,
  SECTION_BACKFILL_POLICY,
  EQUITY_STRUCTURE_DOMAIN_KEYWORDS,
  FINANCIAL_TRANSMISSION_KEYWORDS,
  THEMATIC_KEYWORDS
};
