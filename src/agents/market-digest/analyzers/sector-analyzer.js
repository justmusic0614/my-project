// Sector Analyzer
// 偵測防禦性板塊輪動

/**
 * 防禦性板塊與循環性板塊分類
 */
const DEFENSIVE_SECTORS = [
  'utilities',          // 公用事業
  'healthcare',         // 醫療保健
  'consumer_staples',   // 必需消費品
  'telecom'             // 電信
];

const CYCLICAL_SECTORS = [
  'tech',                      // 科技
  'finance',                   // 金融
  'industrial',                // 工業
  'consumer_discretionary',    // 非必需消費品
  'energy',                    // 能源（循環性）
  'materials'                  // 原物料
];

/**
 * 偵測防禦性板塊輪動
 *
 * @param {Object} sectorData - 板塊數據 { sector: { change: number } }
 * @returns {Object} { isDefensive, spread, confidence, defensiveAvg, cyclicalAvg }
 */
function detectDefensiveRotation(sectorData) {
  // 計算防禦性板塊平均漲幅
  const defensiveChanges = DEFENSIVE_SECTORS
    .map(s => sectorData[s]?.change || 0)
    .filter(v => v !== 0); // 排除缺失數據

  const defensiveAvg = defensiveChanges.length > 0
    ? defensiveChanges.reduce((sum, v) => sum + v, 0) / defensiveChanges.length
    : 0;

  // 計算循環性板塊平均漲幅
  const cyclicalChanges = CYCLICAL_SECTORS
    .map(s => sectorData[s]?.change || 0)
    .filter(v => v !== 0);

  const cyclicalAvg = cyclicalChanges.length > 0
    ? cyclicalChanges.reduce((sum, v) => sum + v, 0) / cyclicalChanges.length
    : 0;

  // 計算 spread（防禦性 - 循環性）
  const spread = defensiveAvg - cyclicalAvg;

  // 判斷標準：防禦性強於循環性 > 1.5%
  const isDefensive = spread > 1.5;

  // 信心度：基於 spread 的絕對值
  // spread = 0 → confidence = 0
  // spread = 3 → confidence = 1.0
  const confidence = Math.min(Math.abs(spread) / 3.0, 1.0);

  return {
    isDefensive,
    spread: parseFloat(spread.toFixed(2)),
    confidence: parseFloat(confidence.toFixed(2)),
    defensiveAvg: parseFloat(defensiveAvg.toFixed(2)),
    cyclicalAvg: parseFloat(cyclicalAvg.toFixed(2)),
    defensiveCount: defensiveChanges.length,
    cyclicalCount: cyclicalChanges.length
  };
}

/**
 * 分析板塊表現詳情
 *
 * @param {Object} sectorData - 板塊數據
 * @returns {Object} 詳細的板塊分析
 */
function analyzeSectorPerformance(sectorData) {
  const rotation = detectDefensiveRotation(sectorData);

  // 找出表現最佳與最差的板塊
  const allSectors = Object.entries(sectorData)
    .map(([sector, data]) => ({
      sector,
      change: data.change || 0
    }))
    .sort((a, b) => b.change - a.change);

  const topPerformers = allSectors.slice(0, 3);
  const worstPerformers = allSectors.slice(-3).reverse();

  // 分類表現
  const defensivePerformance = DEFENSIVE_SECTORS
    .map(s => ({
      sector: s,
      change: sectorData[s]?.change || null
    }))
    .filter(s => s.change !== null)
    .sort((a, b) => b.change - a.change);

  const cyclicalPerformance = CYCLICAL_SECTORS
    .map(s => ({
      sector: s,
      change: sectorData[s]?.change || null
    }))
    .filter(s => s.change !== null)
    .sort((a, b) => b.change - a.change);

  // 生成建議
  let recommendation = '';
  let signal = '';

  if (rotation.isDefensive && rotation.confidence > 0.7) {
    recommendation = '明確的防禦性輪動，建議增持公用事業、必需消費品、醫療保健等防禦性板塊';
    signal = '🔵 DEFENSIVE';
  } else if (!rotation.isDefensive && rotation.spread < -1.5 && rotation.confidence > 0.7) {
    recommendation = '循環性板塊強勢，可增持科技、金融、工業等循環性板塊';
    signal = '🟢 CYCLICAL';
  } else if (Math.abs(rotation.spread) < 0.5) {
    recommendation = '板塊表現平衡，無明顯輪動跡象';
    signal = '➖ BALANCED';
  } else {
    recommendation = '板塊輪動訊號不明確，建議觀望';
    signal = '⚠️ MIXED';
  }

  return {
    rotation,
    topPerformers,
    worstPerformers,
    defensivePerformance,
    cyclicalPerformance,
    recommendation,
    signal,
    timestamp: new Date().toISOString()
  };
}

/**
 * 從新聞推測板塊輪動（輔助功能）
 *
 * @param {Array} newsItems - 新聞項目
 * @returns {Object} 推測的板塊情緒
 */
function inferSectorRotationFromNews(newsItems) {
  const defensiveKeywords = [
    '防禦', '避險', '公用事業', '必需消費', '醫療',
    'defensive', 'utilities', 'staples', 'healthcare'
  ];

  const cyclicalKeywords = [
    '科技', '成長', '金融', '工業', '原物料',
    'tech', 'growth', 'finance', 'industrial', 'materials'
  ];

  let defensiveMentions = 0;
  let cyclicalMentions = 0;

  newsItems.forEach(item => {
    const title = typeof item === 'string' ? item : (item.title || '');
    const lowerTitle = title.toLowerCase();

    if (defensiveKeywords.some(kw => lowerTitle.includes(kw.toLowerCase()))) {
      defensiveMentions++;
    }

    if (cyclicalKeywords.some(kw => lowerTitle.includes(kw.toLowerCase()))) {
      cyclicalMentions++;
    }
  });

  const totalMentions = defensiveMentions + cyclicalMentions;
  const defensiveRatio = totalMentions > 0 ? defensiveMentions / totalMentions : 0;

  let sentiment = 'NEUTRAL';
  if (defensiveRatio > 0.6) {
    sentiment = 'DEFENSIVE';
  } else if (defensiveRatio < 0.4) {
    sentiment = 'CYCLICAL';
  }

  return {
    sentiment,
    defensiveMentions,
    cyclicalMentions,
    defensiveRatio: parseFloat(defensiveRatio.toFixed(2)),
    confidence: totalMentions > 3 ? 'HIGH' : totalMentions > 1 ? 'MEDIUM' : 'LOW'
  };
}

/**
 * 板塊名稱中英對照
 */
const SECTOR_NAMES = {
  'utilities': '公用事業',
  'healthcare': '醫療保健',
  'consumer_staples': '必需消費品',
  'telecom': '電信',
  'tech': '科技',
  'finance': '金融',
  'industrial': '工業',
  'consumer_discretionary': '非必需消費品',
  'energy': '能源',
  'materials': '原物料'
};

/**
 * 取得板塊中文名稱
 */
function getSectorName(sector) {
  return SECTOR_NAMES[sector] || sector;
}

module.exports = {
  detectDefensiveRotation,
  analyzeSectorPerformance,
  inferSectorRotationFromNews,
  getSectorName,
  DEFENSIVE_SECTORS,
  CYCLICAL_SECTORS
};
