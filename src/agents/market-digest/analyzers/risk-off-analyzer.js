// Risk-off Analyzer
// 量化 Risk-off 情緒評分系統（0-100 分）

/**
 * 計算 Risk-off Score
 *
 * 權重分配（V2 - 優化版）：
 * - VIX 指標：30%
 * - 外資動向：25% ⬆️ (提高 5%)
 * - 避險資產（黃金、美債、日圓）：20% ⬇️ (降低 5%)
 * - 股市波動：15%
 * - 新聞情緒：10%
 * - 趨勢加速因子：最高 +15 分（額外獎勵）
 *
 * @param {Object} marketData - 市場數據
 * @param {Array} newsItems - 新聞項目
 * @param {Object} previousData - 前一天市場數據（可選，用於趨勢加速判斷）
 * @returns {number} Risk-off Score (0-100)
 */
function calculateRiskOffScore(marketData, newsItems = [], previousData = null) {
  let score = 0;

  // 1. VIX 指標（30 分）
  const vix = marketData.vix || 15;
  if (vix < 15) {
    score += 0;         // 平靜
  } else if (vix < 20) {
    score += 10;        // 略升
  } else if (vix < 30) {
    score += 20;        // 警戒
  } else {
    score += 30;        // 恐慌
  }

  // 2. 避險資產流向（20 分）⬇️ 降低 5%
  const goldChange = marketData.gold?.change || 0;
  const jpyChange = marketData.usd_jpy?.change || 0; // 負值 = 日圓升值
  const treasuryYield = marketData.treasury?.yield_10y_change || 0; // 負值 = 美債需求增加

  // 黃金（12 分）
  if (goldChange > 2.0) {
    score += 12;  // 黃金大漲
  } else if (goldChange > 1.0) {
    score += 8;
  } else if (goldChange > 0.5) {
    score += 4;
  }

  // 日圓（8 分）
  if (jpyChange < -1.0) {
    score += 8;  // 日圓大幅升值
  } else if (jpyChange < -0.5) {
    score += 4;
  }

  // 美債（額外加權，如果有數據）
  if (treasuryYield < -0.1) {
    score += 4;  // 美債需求增加（殖利率下降）
  }

  // 3. 外資動向（25 分）⬆️ 提高 5%
  const foreignFlow = marketData.foreign?.netBuy || 0;
  if (foreignFlow < -10000) {
    score += 25;  // 大幅賣超（> 100 億）
  } else if (foreignFlow < -5000) {
    score += 19;  // 賣超（> 50 億）
  } else if (foreignFlow < -1000) {
    score += 13;  // 小幅賣超（> 10 億）
  }

  // 4. 股市波動（15 分）
  const indexChange = marketData.stockIndex?.change || 0;
  const volatility = marketData.volatility?.daily || 0;

  if (indexChange < -3.0) {
    score += 15;  // 大跌
  } else if (indexChange < -2.0) {
    score += 10;  // 中跌
  } else if (indexChange < -1.0) {
    score += 5;   // 小跌
  }

  // 額外：波動率加權
  if (volatility > 2.0) {
    score += 5;   // 高波動
  }

  // 5. 新聞情緒（10 分）
  const riskOffKeywords = [
    '暴跌', '重挫', '恐慌', '崩盤', '避險',
    'panic', 'crash', 'plunge', 'selloff', 'risk-off'
  ];

  const negativeCount = newsItems.filter(n => {
    const title = typeof n === 'string' ? n : (n.title || '');
    return riskOffKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
  }).length;

  score += Math.min(negativeCount * 2, 10);

  // 6. 趨勢加速因子（額外最高 +15 分）
  if (previousData) {
    // 外資加速賣超：連續 2 天賣超且幅度增加 → +10 分
    const currentForeignFlow = marketData.foreign?.netBuy || 0;
    const previousForeignFlow = previousData.foreign?.netBuy || 0;

    if (currentForeignFlow < 0 && previousForeignFlow < 0) {
      // 兩天都在賣超
      const acceleration = Math.abs(currentForeignFlow) - Math.abs(previousForeignFlow);
      if (acceleration > 3000) {
        score += 10;  // 賣壓加速 > 30 億
      } else if (acceleration > 1000) {
        score += 5;   // 賣壓加速 > 10 億
      }
    }

    // VIX 快速上升：單日上漲 > 2 → +5 分
    const currentVIX = marketData.vix || 15;
    const previousVIX = previousData.vix || 15;
    const vixChange = currentVIX - previousVIX;

    if (vixChange > 2.0) {
      score += 5;  // VIX 快速上升
    }
  }

  // 限制在 0-100 範圍內
  return Math.min(Math.max(score, 0), 100);
}

/**
 * 取得 Risk-off 等級
 *
 * 閾值（V2 - 優化版）：
 * - HIGH: ≥ 65 (原 75，提早 10 分警示）
 * - MEDIUM: 50-64 (維持不變）
 * - LOW: 35-49 (原 30-49，提高 5 分）
 * - NONE: < 35 (原 < 30，提高 5 分）
 *
 * @param {number} score - Risk-off Score (0-100)
 * @returns {Object} { level, desc, recommendation }
 */
function getRiskOffLevel(score) {
  if (score >= 65) {  // 從 75 降至 65
    return {
      level: 'HIGH',
      desc: 'Risk-off 情緒明確升溫',
      recommendation: '建議降低風險部位，增持防禦性資產（公用事業、必需消費品、黃金）',
      signal: '🔴'
    };
  }

  if (score >= 50) {
    return {
      level: 'MEDIUM',
      desc: 'Risk-off 訊號增加',
      recommendation: '建議適度降低槓桿，觀望為主',
      signal: '🟡'
    };
  }

  if (score >= 35) {  // 從 30 提高至 35
    return {
      level: 'LOW',
      desc: '略有 Risk-off 跡象',
      recommendation: '留意市場變化，保持正常配置',
      signal: '🟢'
    };
  }

  return {
    level: 'NONE',
    desc: '市場風險偏好正常',
    recommendation: '可維持既有配置',
    signal: '✅'
  };
}

/**
 * 生成 Risk-off 分析報告
 *
 * @param {Object} marketData - 市場數據
 * @param {Array} newsItems - 新聞項目
 * @param {Object} previousData - 前一天市場數據（可選）
 * @returns {Object} 完整的 Risk-off 分析
 */
function analyzeRiskOff(marketData, newsItems = [], previousData = null) {
  const score = calculateRiskOffScore(marketData, newsItems, previousData);
  const level = getRiskOffLevel(score);

  // 詳細分項評分
  const breakdown = {
    vix: {
      value: marketData.vix || 15,
      contribution: Math.min((marketData.vix || 15) >= 30 ? 30 :
                             (marketData.vix || 15) >= 20 ? 20 :
                             (marketData.vix || 15) >= 15 ? 10 : 0, 30)
    },
    safeHaven: {
      gold: marketData.gold?.change || 0,
      jpy: marketData.usd_jpy?.change || 0,
      contribution: 0  // 會在下面計算
    },
    foreignFlow: {
      value: marketData.foreign?.netBuy || 0,
      contribution: 0  // 會在下面計算
    },
    marketVolatility: {
      indexChange: marketData.stockIndex?.change || 0,
      contribution: 0  // 會在下面計算
    },
    newsSentiment: {
      negativeCount: 0,  // 會在下面計算
      contribution: 0
    }
  };

  // 計算避險資產貢獻（V2: 20 分）
  const goldChange = marketData.gold?.change || 0;
  const jpyChange = marketData.usd_jpy?.change || 0;

  if (goldChange > 2.0) breakdown.safeHaven.contribution += 12;
  else if (goldChange > 1.0) breakdown.safeHaven.contribution += 8;
  else if (goldChange > 0.5) breakdown.safeHaven.contribution += 4;

  if (jpyChange < -1.0) breakdown.safeHaven.contribution += 8;
  else if (jpyChange < -0.5) breakdown.safeHaven.contribution += 4;

  // 計算外資貢獻（V2: 25 分）
  const foreignFlow = marketData.foreign?.netBuy || 0;
  if (foreignFlow < -10000) breakdown.foreignFlow.contribution = 25;
  else if (foreignFlow < -5000) breakdown.foreignFlow.contribution = 19;
  else if (foreignFlow < -1000) breakdown.foreignFlow.contribution = 13;

  // 計算市場波動貢獻
  const indexChange = marketData.stockIndex?.change || 0;
  if (indexChange < -3.0) breakdown.marketVolatility.contribution = 15;
  else if (indexChange < -2.0) breakdown.marketVolatility.contribution = 10;
  else if (indexChange < -1.0) breakdown.marketVolatility.contribution = 5;

  // 計算新聞情緒貢獻
  const riskOffKeywords = [
    '暴跌', '重挫', '恐慌', '崩盤', '避險',
    'panic', 'crash', 'plunge', 'selloff', 'risk-off'
  ];
  const negativeCount = newsItems.filter(n => {
    const title = typeof n === 'string' ? n : (n.title || '');
    return riskOffKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()));
  }).length;
  breakdown.newsSentiment.negativeCount = negativeCount;
  breakdown.newsSentiment.contribution = Math.min(negativeCount * 2, 10);

  return {
    score,
    level: level.level,
    description: level.desc,
    recommendation: level.recommendation,
    signal: level.signal,
    breakdown,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  calculateRiskOffScore,
  getRiskOffLevel,
  analyzeRiskOff
};
