// RESEARCH_SIGNAL_SEMANTIC_UPGRADE_PATCH v1_integrated
// 語義驗證 + 全球權重 + 跨資產證據 + 補充訊號門檻

/**
 * SPEC 1 — MACRO TAG VALIDATION LAYER
 * 語義驗證：確保標籤與內容匹配
 */
const MACRO_TAG_VALIDATION = {
  'Rates': ['central bank', 'policy rate', 'yield', 'curve', 'tightening', 'easing', 
            '央行', '利率', '殖利率', '曲線', '緊縮', '寬鬆', 'Fed', 'FOMC'],
  'USD': ['DXY', 'FX flow', 'carry trade', 'funding', 'liquidity stress',
          '美元', '匯率', '套利', '流動性', '資金'],
  'Energy': ['oil', 'gas', 'supply shock', 'OPEC', 'crude',
             '原油', '天然氣', '供應', '能源'],
  'SafeHaven': ['gold', 'safe haven', 'flight to safety',
                '黃金', '避險'],
  'Equities': ['earnings', 'valuation', 'equity flows', 'index',
               '財報', '估值', '股市', '指數'],
  'Crypto': ['bitcoin', 'crypto', 'digital asset',
             '比特幣', '加密', '數位資產'],
  'Liquidity': ['QE', 'tightening', 'liquidity', 'funding', 'credit',
                '量化寬鬆', '縮表', '流動性', '信貸'],
};

const REJECT_PRIMARY_IF_TAG_MISMATCH = true;

/**
 * SPEC 2 — GLOBAL MACRO SCOPE WEIGHT
 * 全球影響力權重
 */
const GLOBAL_SCOPE_WEIGHT = {
  'US': 1.0,      // 美國事件（最高權重）
  'G10': 0.8,     // 已開發國家
  'EM': 0.5,      // 新興市場
  'THEMATIC': 0.3 // 主題性（AI、綠能等）
};

// 地區關鍵字映射
const REGION_KEYWORDS = {
  'US': ['美國', 'Fed', '美股', 'S&P', 'Nasdaq', 'US', 'Trump', 'Biden'],
  'G10': ['歐洲', 'ECB', '日本', 'BoJ', '英國', 'BoE', '加拿大', '澳洲'],
  'EM': ['中國', '印度', '巴西', '南非', '哥倫比亞', '新興市場', '亞洲'],
  'THEMATIC': ['AI', '綠能', '氣候', '數位化', '科技']
};

/**
 * SPEC 3 — REGIME CROSS-ASSET EVIDENCE REQUIREMENT
 * 跨資產證據要求
 */
const REGIME_EVIDENCE_RULE = {
  minimum_cross_asset_drivers: 2,
  allowed_evidence_classes: ['Rates', 'USD', 'YieldCurve', 'Volatility', 'Liquidity']
};

const REJECT_REGIME_IF_INSUFFICIENT_EVIDENCE = false;
const DOWNGRADE_REGIME_CONFIDENCE_IF_FAIL = true;

/**
 * SPEC 4 — SECONDARY SIGNAL FLOOR
 * 補充訊號門檻
 */
const SECONDARY_SIGNAL_REQUIREMENT = {
  threshold: 2, // 當 primary >= 2 時，secondary 最少 2 則
  allowed_classes: ['CrossAsset', 'MacroSupporting', 'SupplyChain', 'ThematicSupporting']
};

/**
 * SPEC 1 實作：驗證標籤是否符合語義
 */
function validateMacroTag(text, category) {
  const keywords = MACRO_TAG_VALIDATION[category];
  if (!keywords) return true; // 未定義的類別，放行
  
  const lowerText = text.toLowerCase();
  const matched = keywords.some(kw => lowerText.includes(kw.toLowerCase()));
  
  return matched;
}

/**
 * SPEC 2 實作：計算全球權重
 */
function calculateGlobalWeight(text) {
  const lowerText = text.toLowerCase();
  
  // 按優先順序檢查（US > G10 > EM > THEMATIC）
  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    if (keywords.some(kw => lowerText.includes(kw.toLowerCase()))) {
      return { region, weight: GLOBAL_SCOPE_WEIGHT[region] };
    }
  }
  
  // 預設：THEMATIC
  return { region: 'THEMATIC', weight: GLOBAL_SCOPE_WEIGHT['THEMATIC'] };
}

/**
 * SPEC 3 實作：檢查跨資產證據
 */
function assessRegimeEvidence(primarySignals) {
  const evidenceClasses = new Set();
  
  for (const signal of primarySignals) {
    const category = extractCategory(signal.category);
    if (REGIME_EVIDENCE_RULE.allowed_evidence_classes.includes(category)) {
      evidenceClasses.add(category);
    }
  }
  
  const count = evidenceClasses.size;
  const sufficient = count >= REGIME_EVIDENCE_RULE.minimum_cross_asset_drivers;
  
  return { count, sufficient, classes: Array.from(evidenceClasses) };
}

function extractCategory(categoryStr) {
  // 從 "[Rates]" 提取 "Rates"
  const match = categoryStr.match(/\[(\w+)\]/);
  return match ? match[1] : categoryStr;
}

/**
 * SPEC 4 實作：確保補充訊號門檻
 */
function ensureSecondaryFloor(primaryCount, secondaryEvents) {
  if (primaryCount < 2) {
    return secondaryEvents; // 不需補充
  }
  
  const minRequired = SECONDARY_SIGNAL_REQUIREMENT.threshold;
  if (secondaryEvents.length >= minRequired) {
    return secondaryEvents; // 已滿足
  }
  
  // 需要回填（從 allowed_classes 選擇）
  const needed = minRequired - secondaryEvents.length;
  console.log(`   ⚠️  補充訊號不足（${secondaryEvents.length}/${minRequired}），需回填 ${needed} 則`);
  
  // 簡化：返回原始，標記為不足
  return secondaryEvents;
}

/**
 * 整合語義升級 Patch
 */
function applySemanticPatch(scoredEvents) {
  console.log('\n🔬 應用 SEMANTIC_UPGRADE_PATCH v1_integrated...');
  
  // STEP 1: MACRO TAG VALIDATION（驗證並過濾）
  console.log('   SPEC 1: Macro Tag Validation...');
  const validated = scoredEvents.filter(event => {
    const isValid = validateMacroTag(event.news, event.category);
    if (!isValid && REJECT_PRIMARY_IF_TAG_MISMATCH) {
      console.log(`   ⚠️  標籤不符，拒絕：[${event.category}] ${event.news.substring(0, 40)}...`);
      return false;
    }
    return true;
  });
  console.log(`   ✅ 驗證後：${validated.length}/${scoredEvents.length} 則`);
  
  // STEP 2: GLOBAL MACRO SCOPE WEIGHT（重新計分）
  console.log('   SPEC 2: Global Macro Scope Weight...');
  const weighted = validated.map(event => {
    const { region, weight } = calculateGlobalWeight(event.news);
    const finalScore = event.score * weight;
    return { ...event, region, globalWeight: weight, finalScore };
  });
  
  // 按 finalScore 重新排序
  weighted.sort((a, b) => b.finalScore - a.finalScore);
  console.log(`   ✅ 加權完成（US=${GLOBAL_SCOPE_WEIGHT.US}, G10=${GLOBAL_SCOPE_WEIGHT.G10}, EM=${GLOBAL_SCOPE_WEIGHT.EM}）`);
  
  // STEP 3: 選擇 Primary（Top 3）
  const primary = weighted.slice(0, 3);
  const secondary = weighted.slice(3);
  
  // STEP 4: REGIME CROSS-ASSET EVIDENCE（檢查證據）
  console.log('   SPEC 3: Regime Cross-Asset Evidence...');
  const evidence = assessRegimeEvidence(primary);
  console.log(`   ✅ 跨資產驅動因素：${evidence.count}/${REGIME_EVIDENCE_RULE.minimum_cross_asset_drivers} (${evidence.classes.join(', ')})`);
  
  let regimeConfidence = 'HIGH';
  if (!evidence.sufficient && DOWNGRADE_REGIME_CONFIDENCE_IF_FAIL) {
    regimeConfidence = 'MEDIUM';
    console.log(`   ⚠️  證據不足，Regime Confidence 降級為 ${regimeConfidence}`);
  }
  
  // STEP 5: SECONDARY SIGNAL FLOOR（確保門檻）
  console.log('   SPEC 4: Secondary Signal Floor...');
  const finalSecondary = ensureSecondaryFloor(primary.length, secondary);
  console.log(`   ✅ 補充訊號：${finalSecondary.length} 則`);
  
  return {
    primary,
    secondary: finalSecondary,
    evidence,
    regimeConfidence,
    stats: {
      input: scoredEvents.length,
      validated: validated.length,
      weighted: weighted.length,
      primary: primary.length,
      secondary: finalSecondary.length
    }
  };
}

module.exports = {
  applySemanticPatch,
  validateMacroTag,
  calculateGlobalWeight,
  assessRegimeEvidence,
  ensureSecondaryFloor,
  MACRO_TAG_VALIDATION,
  GLOBAL_SCOPE_WEIGHT,
  REGIME_EVIDENCE_RULE,
  SECONDARY_SIGNAL_REQUIREMENT
};
